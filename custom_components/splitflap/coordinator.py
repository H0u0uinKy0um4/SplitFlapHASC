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

    # Some firmware only reports the drum plus the active index. Derive the
    # visible flap so the entity state and card stay useful.
    for module in modules.values():
        if module.get("flap") is None:
            flap = module_flap(module)
            if flap is not None:
                module["flap"] = flap

    return modules


def _coerce_count(value: Any, fallback: int) -> int:
    """Coerce a module count to a non-negative integer."""
    try:
        return max(int(value), 0)
    except (TypeError, ValueError):
        return max(fallback, 0)


#: Accepted payload names for each canonical per-module stat. Firmware can send
#: snake_case, camelCase or the PascalCase names used by the C++ module objects.
MODULE_STAT_ALIASES: dict[str, tuple[str, ...]] = {
    "flap_list": (
        "flap_list",
        "flapList",
        "FlapList",
        "flaps",
        "drum",
        "drum_chars",
        "drumChars",
        "characters",
    ),
    "current_step": (
        "current_step",
        "currentStep",
        "CurrentStep",
        "current_step_pos",
        "currentStepPos",
        "step",
        "step_position",
        "position_step",
    ),
    "auto_homing": (
        "auto_homing",
        "autoHoming",
        "AutoHoming",
        "auto_home",
        "autoHome",
        "autoHomeEnabled",
        "autohome",
    ),
    "home_offset": (
        "home_offset",
        "homeOffset",
        "HomeOffset",
        "hall_offset",
        "hallOffset",
    ),
    "total_steps": (
        "total_steps",
        "totalSteps",
        "TotalSteps",
        "total_steps_per_rev",
        "totalStepsPerRev",
        "steps_per_rev",
        "stepsPerRev",
        "max_steps",
        "maxSteps",
    ),
    "current_index": (
        "current_index",
        "currentIndex",
        "CurrentIndex",
        "current_flap_index",
        "currentFlapIndex",
        "flap_index",
        "flapIndex",
        "index",
    ),
    "map_of_positions": (
        "map_of_positions",
        "mapOfPositions",
        "MapOfPositions",
        "position_map",
        "positionMap",
        "positions",
        "map",
    ),
    "online": ("online", "is_online", "isOnline", "connected"),
    "last_seen": ("last_seen", "lastSeen", "last_seen_ms", "lastSeenMs"),
}

#: Per-module payloads may nest the stats in one of these objects.
_MODULE_STAT_CONTAINERS = ("stats", "config", "details", "module_stats")
_MODULE_STATE_KEYS = ("state", "module_state", "status")


def module_state(module: dict[str, Any]) -> str:
    """Return the module state from any of the supported payload keys."""
    for key in _MODULE_STATE_KEYS:
        if key in module and module[key] is not None:
            value = module[key]
            return str(value) if value != "" else "unknown"
    return "unknown"


def _module_sources(module: dict[str, Any]) -> list[dict[str, Any]]:
    """Return the module dict plus any nested stat containers."""
    sources = [module]
    for key in _MODULE_STAT_CONTAINERS:
        nested = module.get(key)
        if isinstance(nested, dict):
            sources.append(nested)
    return sources


def _first_module_value(
    sources: list[dict[str, Any]], aliases: tuple[str, ...]
) -> Any:
    """Return the first non-null alias found in any source."""
    for source in sources:
        for alias in aliases:
            if alias in source and source[alias] is not None:
                return source[alias]
    return None


def _coerce_optional_bool(value: Any) -> bool | None:
    """Coerce common boolean representations to a bool."""
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    if isinstance(value, str):
        text = value.strip().lower()
        if text in {"1", "true", "yes", "on", "enabled", "online"}:
            return True
        if text in {"0", "false", "no", "off", "disabled", "offline"}:
            return False
    return bool(value)


def _coerce_optional_int(value: Any) -> int | None:
    """Coerce a value to an int, returning None when it is not numeric."""
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def normalize_flap_list(value: Any) -> list[str] | None:
    """Normalize a drum/flap list to an ordered list of characters."""
    if value is None:
        return None
    if isinstance(value, str):
        # Firmware often sends the whole 64-character drum as one string.
        return list(value)
    if isinstance(value, dict):
        items = sorted(value.items(), key=lambda item: module_sort_key(item[0]))
        return ["" if item is None else str(item) for _, item in items]
    if isinstance(value, (list, tuple)):
        return ["" if item is None else str(item) for item in value]
    return [str(value)]


def normalize_position_map(value: Any) -> dict[str, int | str] | None:
    """Normalize a map of flap index -> step position."""
    if value is None:
        return None

    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        if text.startswith("{"):
            try:
                return normalize_position_map(json.loads(text))
            except json.JSONDecodeError:
                return None
        # Slave firmware format: "0=0,16=1024,32=2048"
        result: dict[str, int | str] = {}
        for pair in text.split(","):
            key, separator, position = pair.partition("=")
            if not separator:
                continue
            index = _coerce_optional_int(key)
            pos = _coerce_optional_int(position)
            result[str(index) if index is not None else key.strip()] = (
                pos if pos is not None else position.strip()
            )
        return result or None

    if isinstance(value, dict):
        result = {}
        for key, item in value.items():
            if isinstance(item, dict):
                item = item.get("position", item.get("pos", item.get("step")))
            position = _coerce_optional_int(item)
            result[str(key)] = position if position is not None else item
        return result

    if isinstance(value, (list, tuple)):
        result = {}
        for fallback_index, item in enumerate(value):
            if isinstance(item, dict):
                index = item.get("index", item.get("flap", fallback_index))
                item = item.get("position", item.get("pos", item.get("step")))
            else:
                index = fallback_index
            position = _coerce_optional_int(item)
            result[str(index)] = position if position is not None else item
        return result

    return None


def module_stats(module: dict[str, Any]) -> dict[str, Any]:
    """Extract the optional per-module stats exposed as entity attributes."""
    sources = _module_sources(module)
    stats: dict[str, Any] = {}

    flap_list = normalize_flap_list(
        _first_module_value(sources, MODULE_STAT_ALIASES["flap_list"])
    )
    if flap_list is not None:
        stats["flap_list"] = flap_list

    for key in ("current_step", "home_offset", "total_steps", "current_index"):
        value = _coerce_optional_int(
            _first_module_value(sources, MODULE_STAT_ALIASES[key])
        )
        if value is not None:
            stats[key] = value

    auto_homing = _coerce_optional_bool(
        _first_module_value(sources, MODULE_STAT_ALIASES["auto_homing"])
    )
    if auto_homing is not None:
        stats["auto_homing"] = auto_homing

    online = _coerce_optional_bool(
        _first_module_value(sources, MODULE_STAT_ALIASES["online"])
    )
    if online is not None:
        stats["online"] = online

    last_seen = _first_module_value(sources, MODULE_STAT_ALIASES["last_seen"])
    if last_seen is not None:
        stats["last_seen"] = last_seen

    positions = normalize_position_map(
        _first_module_value(sources, MODULE_STAT_ALIASES["map_of_positions"])
    )
    if positions is not None:
        stats["map_of_positions"] = positions

    # Keep any additional firmware-specific fields visible in the more-info
    # dialog instead of silently dropping them.
    known = {"id", "flap", *_MODULE_STATE_KEYS, *_MODULE_STAT_CONTAINERS}
    for aliases in MODULE_STAT_ALIASES.values():
        known.update(aliases)
    extra: dict[str, Any] = {}
    for source in sources:
        for key, value in source.items():
            if key not in known and value is not None:
                extra[key] = value
    if extra:
        stats["extra_stats"] = extra

    return stats


def module_flap(module: dict[str, Any]) -> Any:
    """Return the current flap, deriving it from the drum index if needed."""
    flap = module.get("flap")
    if flap is not None:
        return flap

    stats = module_stats(module)
    flap_list = stats.get("flap_list")
    index = stats.get("current_index")
    if (
        isinstance(flap_list, list)
        and isinstance(index, int)
        and 0 <= index < len(flap_list)
    ):
        return flap_list[index]
    return None


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
            sw_version="1.2",
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

    async def send_text(self, text: str, start: int = 1) -> None:
        """Send a display text command to the ESP32.

        ``start`` is a 1-based module position. The firmware maps text to
        modules from the left, so leading spaces are used to place the text.
        """
        text = str(text)
        try:
            start = max(int(start), 1)
        except (TypeError, ValueError):
            start = 1
        if start > 1:
            text = (" " * (start - 1)) + text

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
        _LOGGER.info(
            "Published display command '%s' at module %s to %s",
            text,
            start,
            topic,
        )

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
