"""Text entity platform for SplitFlap."""
from __future__ import annotations

from homeassistant.components.text import TextEntity, TextMode
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
    """Set up SplitFlap text entities."""
    coordinator: SplitFlapCoordinator = hass.data[DOMAIN][entry.entry_id]
    async_add_entities([SplitFlapTextEntity(coordinator)])


class SplitFlapTextEntity(CoordinatorEntity[SplitFlapCoordinator], TextEntity):
    """Representation of a SplitFlap Text Input."""

    _attr_has_entity_name = True
    _attr_name = "Display Text"
    _attr_icon = "mdi:format-text"
    _attr_mode = TextMode.TEXT

    def __init__(self, coordinator: SplitFlapCoordinator) -> None:
        """Initialize the text entity."""
        super().__init__(coordinator)
        self._attr_unique_id = f"{coordinator.prefix}_display_text"
        self._attr_device_info = coordinator.device_info

    @property
    def native_value(self) -> str:
        """Return the current text from coordinator data."""
        return str(self.coordinator.data.get("last_message", ""))

    async def async_set_value(self, value: str) -> None:
        """Update the current value and push to hardware."""
        await self.coordinator.send_text(value)
