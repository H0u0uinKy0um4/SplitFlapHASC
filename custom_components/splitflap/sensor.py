"""Sensor platform for SplitFlap."""
from __future__ import annotations

from typing import Any

from homeassistant.components.sensor import SensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN
from .coordinator import SplitFlapCoordinator


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up SplitFlap sensors."""
    coordinator: SplitFlapCoordinator = hass.data[DOMAIN][entry.entry_id]

    entities = [
        SplitFlapModulesCountSensor(coordinator),
        SplitFlapStatusSensor(coordinator),
    ]

    async_add_entities(entities)


class SplitFlapModulesCountSensor(CoordinatorEntity[SplitFlapCoordinator], SensorEntity):
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
        return int(self.coordinator.data.get("modules_count", 0))

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Return details for individual modules."""
        return {
            "modules": self.coordinator.data.get("modules", {}),
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
        }
