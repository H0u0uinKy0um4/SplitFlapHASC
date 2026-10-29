"""Sensor platform for SplitFlap."""
from __future__ import annotations

from typing import Any

from homeassistant.components.sensor import SensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN
from .coordinator import SplitFlapCoordinator, module_sort_key


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up SplitFlap sensors."""
    coordinator: SplitFlapCoordinator = hass.data[DOMAIN][entry.entry_id]

    registered_modules: set[str] = set()

    @callback
    def _add_new_module_entities() -> None:
        """Create one sensor entity for every module reported by the hardware."""
        modules: dict[str, Any] = coordinator.data.get("modules", {})
        new_ids = sorted(
            (module_id for module_id in modules if module_id not in registered_modules),
            key=module_sort_key,
        )
        if not new_ids:
            return

        registered_modules.update(new_ids)
        async_add_entities(
            SplitFlapModuleSensor(coordinator, module_id) for module_id in new_ids
        )

    async_add_entities(
        [
            SplitFlapModulesCountSensor(coordinator),
            SplitFlapStatusSensor(coordinator),
        ]
    )

    _add_new_module_entities()
    entry.async_on_unload(coordinator.async_add_listener(_add_new_module_entities))


class SplitFlapModulesCountSensor(
    CoordinatorEntity[SplitFlapCoordinator], SensorEntity
):
    """Sensor reporting total detected modules on the RS485 bus."""

    _attr_has_entity_name = True
    _attr_name = "Detected Modules"
    _attr_icon = "mdi:counter"

    def __init__(self, coordinator: SplitFlapCoordinator) -> None:
        """Initialize the modules count sensor."""
        super().__init__(coordinator)
        self._attr_unique_id = f"{coordinator.prefix}_modules_count"
        self._attr_device_info = coordinator.device_info

    @property
    def native_value(self) -> int:
        """Return total module count from ESP32 payload."""
        try:
            return max(int(self.coordinator.data.get("modules_count", 0)), 0)
        except (TypeError, ValueError):
            return 0

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Return details for individual modules."""
        modules = self.coordinator.data.get("modules", {})
        module_ids = sorted(modules, key=module_sort_key)
        return {
            "modules": modules,
            "module_ids": module_ids,
            "topic_prefix": self.coordinator.prefix,
        }


class SplitFlapStatusSensor(CoordinatorEntity[SplitFlapCoordinator], SensorEntity):
    """Sensor reporting master ESP32 connection status."""

    _attr_has_entity_name = True
    _attr_name = "Master Status"
    _attr_icon = "mdi:chip"

    def __init__(self, coordinator: SplitFlapCoordinator) -> None:
        """Initialize the status sensor."""
        super().__init__(coordinator)
        self._attr_unique_id = f"{coordinator.prefix}_master_status"
        self._attr_device_info = coordinator.device_info

    @property
    def native_value(self) -> str:
        """Return status string."""
        return str(self.coordinator.data.get("status", "offline"))

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Return extra state attributes."""
        return {
            "last_message": self.coordinator.data.get("last_message", ""),
            "topic_prefix": self.coordinator.prefix,
        }


class SplitFlapModuleSensor(CoordinatorEntity[SplitFlapCoordinator], SensorEntity):
    """Representation of a single split-flap module."""

    _attr_has_entity_name = True
    _attr_icon = "mdi:view-grid-outline"

    def __init__(self, coordinator: SplitFlapCoordinator, module_id: str) -> None:
        """Initialize a module sensor."""
        super().__init__(coordinator)
        self._module_id = module_id
        self._attr_name = f"Module {module_id}"
        self._attr_unique_id = (
            f"{coordinator.entry.entry_id}_module_{module_id}"
        )
        self._attr_device_info = coordinator.device_info

    @property
    def _module(self) -> dict[str, Any]:
        """Return the current data for this module."""
        module = self.coordinator.data.get("modules", {}).get(self._module_id)
        return module if isinstance(module, dict) else {}

    @property
    def _position(self) -> int | None:
        """Return this module's 1-based position on the bus."""
        module_ids = sorted(
            self.coordinator.data.get("modules", {}), key=module_sort_key
        )
        try:
            return module_ids.index(self._module_id) + 1
        except ValueError:
            return None

    @property
    def available(self) -> bool:
        """Return whether this module is currently reported by the hardware."""
        return (
            super().available
            and self._module_id in self.coordinator.data.get("modules", {})
        )

    @property
    def native_value(self) -> str:
        """Return the flap character currently shown by the module."""
        flap = self._module.get("flap")
        return "" if flap is None else str(flap)

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Return module details and discovery metadata for the Lovelace card."""
        module = self._module
        return {
            # Namespaced attributes are used by the card to find module entities
            # without relying on entity-id naming.
            "splitflap_module_id": self._module_id,
            "splitflap_prefix": self.coordinator.prefix,
            "module_id": self._module_id,
            "position": self._position,
            "flap": module.get("flap"),
            "module_state": str(module.get("state") or "unknown"),
            "topic_prefix": self.coordinator.prefix,
        }
