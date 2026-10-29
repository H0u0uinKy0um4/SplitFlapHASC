"""DataUpdateCoordinator for SplitFlap."""
from __future__ import annotations

import json
import logging
from typing import Any

from homeassistant.components import mqtt
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator

from .const import CONF_TOPIC_PREFIX, DEFAULT_TOPIC_PREFIX, DOMAIN

_LOGGER = logging.getLogger(__name__)


class SplitFlapCoordinator(DataUpdateCoordinator[dict[str, Any]]):
    """Class to manage fetching SplitFlap data over MQTT."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        """Initialize the SplitFlap coordinator."""
        self.entry = entry
        self.prefix = entry.data.get(CONF_TOPIC_PREFIX, DEFAULT_TOPIC_PREFIX).strip().rstrip("/")

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

    @property
    def device_info(self) -> DeviceInfo:
        """Return device info for SplitFlap."""
        return DeviceInfo(
            identifiers={(DOMAIN, self.entry.entry_id)},
            name=f"SplitFlap ({self.prefix})",
            manufacturer="DIY",
            model="ESP32-C3 RS485 Master",
            sw_version="1.0",
        )

    async def async_setup(self) -> None:
        """Subscribe to status updates from the ESP32."""
        status_topic = f"{self.prefix}/status"

        @callback
        def message_received(msg) -> None:
            """Handle received MQTT messages."""
            try:
                payload = json.loads(msg.payload)
                if not isinstance(payload, dict):
                    _LOGGER.warning("MQTT payload is not a JSON object: %s", msg.payload)
                    return

                new_data = dict(self.data)
                new_data["status"] = payload.get("state", "online")
                new_data["modules_count"] = payload.get("modules_count", 0)
                if "text" in payload:
                    new_data["last_message"] = payload["text"]

                raw_modules = payload.get("modules", [])
                if isinstance(raw_modules, list):
                    new_data["modules"] = {
                        str(m.get("id")): m for m in raw_modules if isinstance(m, dict) and "id" in m
                    }
                elif isinstance(raw_modules, dict):
                    new_data["modules"] = raw_modules

                self.async_set_updated_data(new_data)
                _LOGGER.debug("SplitFlap state updated: %s", new_data)
            except json.JSONDecodeError:
                _LOGGER.error("Failed to decode MQTT JSON payload: %s", msg.payload)

        self._mqtt_unsub = await mqtt.async_subscribe(self.hass, status_topic, message_received)
        _LOGGER.info("Subscribed to SplitFlap status on %s", status_topic)

        # Trigger initial sync request to get the display current status
        await self.fetch_esp32_data()

    async def async_unload(self) -> None:
        """Clean up MQTT subscription when component unloads."""
        if self._mqtt_unsub:
            self._mqtt_unsub()
            self._mqtt_unsub = None
            _LOGGER.info("Unsubscribed from SplitFlap MQTT topic.")

    async def send_text(self, text: str) -> None:
        """Send a display text command to the ESP32."""
        topic = f"{self.prefix}/command/display"
        payload = json.dumps({"text": text})
        await mqtt.async_publish(self.hass, topic, payload)

        # Optimistically update last_message
        updated = dict(self.data)
        updated["last_message"] = text
        self.async_set_updated_data(updated)
        _LOGGER.debug("Published display command '%s' to %s", text, topic)

    async def trigger_bus_scan(self) -> None:
        """Request the ESP32 to scan the RS485 bus."""
        topic = f"{self.prefix}/command/scan"
        await mqtt.async_publish(self.hass, topic, json.dumps({"action": "scan"}))
        _LOGGER.info("Requested RS485 bus scan on %s", topic)

    async def fetch_esp32_data(self) -> None:
        """Publish a request asking the ESP32 to report its current modules and sync."""
        topic = f"{self.prefix}/command/sync"
        payload = json.dumps({"action": "fetch_state"})
        await mqtt.async_publish(self.hass, topic, payload)
        _LOGGER.info("Requested sync/fetch state on %s", topic)
