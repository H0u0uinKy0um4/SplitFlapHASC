"""DataUpdateCoordinator for SplitFlap."""
from __future__ import annotations

import json
import logging
import re
from typing import Any

from homeassistant.components import mqtt
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import CALLBACK_TYPE, HomeAssistant, callback
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.event import async_call_later
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator

from .const import CONF_TOPIC_PREFIX, DEFAULT_NAME, DEFAULT_TOPIC_PREFIX, DOMAIN

_LOGGER = logging.getLogger(__name__)

_NUMERIC_ID = re.compile(r"^\d+$")


def module_sort_key(module_id: Any) -> tuple[int, int | str]:
    """Return a stable, natural sort key for a module id."""
    value = str(module_id).strip()
    if _NUMERIC_ID.match(value):
        return (0, int(value))
    return (1, value.casefold())


def normalize_modules(raw_modules: Any) -> dict[str, dict[str, Any]]:
    """Normalize the different module payload shapes into an id -> module map."""
    modules: dict[str, dict[str, Any]] = {}

    if isinstance(raw_modules, list):
        for item in raw_modules:
            if not isinstance(item, dict) or item.get("id") is None:
                continue
            module = dict(item)
            module["id"] = item["id"]
            modules[str(item["id"])] = module
    elif isinstance(raw_modules, dict):
        for module_id, item in raw_modules.items():
            if isinstance(item, dict):
                module = dict(item)
            else:
                module = {"id": module_id, "flap": item}
            module.setdefault("id", module_id)
            modules[str(module_id)] = module

    return modules


def _coerce_count(value: Any, fallback: int) -> int:
    """Coerce a module count to a non-negative integer."""
    try:
        return max(int(value), 0)
    except (TypeError, ValueError):
        return max(fallback, 0)


class SplitFlapCoordinator(DataUpdateCoordinator[dict[str, Any]]):
    """Class to manage fetching SplitFlap data over MQTT."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        """Initialize the SplitFlap coordinator."""
        self.entry = entry
        self.prefix = (
            entry.options.get(
                CONF_TOPIC_PREFIX,
                entry.data.get(CONF_TOPIC_PREFIX, DEFAULT_TOPIC_PREFIX),
            )
            .strip()
            .rstrip("/")
        )

        super().__init__(
            hass,
            _LOGGER,
            name=f"SplitFlap ({self.prefix})",
            update_interval=None,  # Push updates via MQTT
        )

        self.data: dict[str, Any] = {
            "status": "offline",
            "modules_count": 0,
            "modules": {},
            "last_message": "",
        }
        self._mqtt_unsub = None
        self._offline_timer: CALLBACK_TYPE | None = None
        self._offline_timeout_seconds: int = 60

    @property
    def device_info(self) -> DeviceInfo:
        """Return device info for SplitFlap."""
        name = (
            DEFAULT_NAME
            if self.prefix == DEFAULT_TOPIC_PREFIX
            else f"{DEFAULT_NAME} {self.prefix}"
        )
        return DeviceInfo(
            identifiers={(DOMAIN, self.entry.entry_id)},
            name=name,
            manufacturer="DIY",
            model="ESP32-C3 RS485 Master",
            sw_version="1.1",
        )

    async def async_setup(self) -> None:
        """Subscribe to status updates from the ESP32."""
        status_topic = f"{self.prefix}/status"

        @callback
        def message_received(msg) -> None:
            """Handle received MQTT messages."""
            try:
                payload = json.loads(msg.payload)
            except (json.JSONDecodeError, UnicodeDecodeError):
                _LOGGER.error("Failed to decode MQTT JSON payload: %s", msg.payload)
                return

            if not isinstance(payload, dict):
                _LOGGER.warning("MQTT payload is not a JSON object: %s", msg.payload)
                return

            self._handle_status_payload(payload)

        self._mqtt_unsub = await mqtt.async_subscribe(
            self.hass, status_topic, message_received
        )
        _LOGGER.info("Subscribed to SplitFlap status on %s", status_topic)

        # Trigger initial sync request to get the display current status
        await self.fetch_esp32_data()

    @callback
    def _handle_status_payload(self, payload: dict[str, Any]) -> None:
        """Merge a status payload into the coordinator data."""
        new_data = dict(self.data)

        if "state" in payload:
            state = payload["state"]
            new_data["status"] = str(state) if state is not None else "online"

        if "text" in payload and isinstance(payload["text"], str):
            new_data["last_message"] = payload["text"]

        if "modules" in payload:
            raw_modules = payload["modules"]
            if isinstance(raw_modules, (list, dict)):
                modules = normalize_modules(raw_modules)
                new_data["modules"] = modules
                # Prefer the real number of reported modules over the count
                # field, which can be stale in older firmware. Only fall back
                # to the count when no module details were provided.
                reported_count = _coerce_count(
                    payload.get("modules_count"), len(modules)
                )
                new_data["modules_count"] = (
                    len(modules) if modules else reported_count
                )
            else:
                _LOGGER.warning(
                    "Ignoring invalid modules payload from SplitFlap: %s",
                    raw_modules,
                )
        elif "modules_count" in payload:
            new_data["modules_count"] = _coerce_count(
                payload["modules_count"], new_data.get("modules_count", 0)
            )

        self.async_set_updated_data(new_data)
        _LOGGER.debug("SplitFlap state updated: %s", new_data)

        # Reset 60s inactivity timer
        self._reset_offline_timer()

    @callback
    def _reset_offline_timer(self) -> None:
        """Reset the offline timeout timer."""
        if self._offline_timer is not None:
            self._offline_timer()
            self._offline_timer = None

        @callback
        def _handle_timeout(_now) -> None:
            """Mark coordinator status as offline after timeout."""
            _LOGGER.warning(
                "No MQTT message received from SplitFlap (%s) for %s seconds. "
                "Marking offline.",
                self.prefix,
                self._offline_timeout_seconds,
            )
            self._offline_timer = None
            data = dict(self.data)
            data["status"] = "offline"
            self.async_set_updated_data(data)

        self._offline_timer = async_call_later(
            self.hass, self._offline_timeout_seconds, _handle_timeout
        )

    async def async_unload(self) -> None:
        """Clean up MQTT subscription and timers when component unloads."""
        if self._offline_timer is not None:
            self._offline_timer()
            self._offline_timer = None

        if self._mqtt_unsub:
            self._mqtt_unsub()
            self._mqtt_unsub = None
            _LOGGER.info("Unsubscribed from SplitFlap MQTT topic.")

    async def send_text(self, text: str) -> None:
        """Send a display text command to the ESP32."""
        text = str(text)

        # Optimistically update last_message and module flap characters
        updated = dict(self.data)
        updated["last_message"] = text

        modules = updated.get("modules")
        if isinstance(modules, dict) and modules:
            new_modules: dict[str, dict[str, Any]] = {}
            sorted_ids = sorted(modules, key=module_sort_key)
            for index, module_id in enumerate(sorted_ids):
                module = modules[module_id]
                module_data = dict(module) if isinstance(module, dict) else {}
                module_data["flap"] = text[index] if index < len(text) else ""
                new_modules[module_id] = module_data
            updated["modules"] = new_modules

        self.async_set_updated_data(updated)

        topic = f"{self.prefix}/command/display"
        payload = json.dumps({"text": text})
        await mqtt.async_publish(self.hass, topic, payload)
        _LOGGER.info("Published display command '%s' to %s", text, topic)

    async def trigger_bus_scan(self) -> None:
        """Request the ESP32 to scan the RS485 bus."""
        topic = f"{self.prefix}/command/scan"
        await mqtt.async_publish(self.hass, topic, json.dumps({"action": "scan"}))
        _LOGGER.info("Requested RS485 bus scan on %s", topic)

    async def fetch_esp32_data(self) -> None:
        """Publish a request asking the ESP32 to report its current modules."""
        topic = f"{self.prefix}/command/sync"
        payload = json.dumps({"action": "fetch_state"})
        await mqtt.async_publish(self.hass, topic, payload)
        _LOGGER.info("Requested sync/fetch state on %s", topic)
