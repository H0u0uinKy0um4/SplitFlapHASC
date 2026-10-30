"""Button platform for SplitFlap."""
from __future__ import annotations

from homeassistant.components.button import ButtonEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN
from .coordinator import SplitFlapCoordinator


class SplitFlapBaseButton(CoordinatorEntity[SplitFlapCoordinator], ButtonEntity):
    """Base class for all SplitFlap button entities.

    Sets common boilerplate like device_info, unique_id prefix, and entity naming.
    """

    _attr_has_entity_name = True
    button_id: str = ""

    def __init__(self, coordinator: SplitFlapCoordinator) -> None:
        """Initialize the button entity."""
        super().__init__(coordinator)
        self._attr_unique_id = f"{coordinator.prefix}_{self.button_id}"
        self._attr_device_info = coordinator.device_info


# =============================================================================
# BUTTON DEFINITIONS
# To add a new button:
# 1. Copy one of the button classes below and give it a unique class name.
# 2. Change `button_id`, `_attr_name`, `_attr_icon`, and `async_press`.
# 3. Add your new class to the BUTTON_CLASSES list at the bottom of this file.
# =============================================================================


class SplitFlapSyncButton(SplitFlapBaseButton):
    """Button to fetch current state and sync modules from ESP32."""

    button_id = "sync"
    _attr_name = "Sync"
    _attr_icon = "mdi:sync"

    async def async_press(self) -> None:
        """Trigger the fetch/sync command."""
        await self.coordinator.fetch_esp32_data()


class SplitFlapScanButton(SplitFlapBaseButton):
    """Button to trigger an RS485 bus scan on the hardware."""

    button_id = "scan"
    _attr_name = "Scan"
    _attr_icon = "mdi:radar"

    async def async_press(self) -> None:
        """Handle the button press."""
        await self.coordinator.trigger_bus_scan()


# =============================================================================
# BUTTON REGISTRATION
# Add any new button class to this list so Home Assistant registers it.
# =============================================================================

BUTTON_CLASSES: list[type[SplitFlapBaseButton]] = [
    SplitFlapSyncButton,
    SplitFlapScanButton,
    SplitFlapUpdateButton,
]


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up SplitFlap button entities."""
    coordinator: SplitFlapCoordinator = hass.data[DOMAIN][entry.entry_id]
    async_add_entities(button_cls(coordinator) for button_cls in BUTTON_CLASSES)

//Button For Refresh
class SplitFlapUpdateButton(SplitFlapBaseButton):
    """Update without whole scan."""

    button_id = "update"          # Lowercase unique suffix (e.g. "clear"). Creates entity button.<device>_clear
    _attr_name = "update"         # Name shown in Home Assistant UI (e.g. "Clear Display")
    _attr_icon = "mdi:sync"     # Icon from materialdesignicons.com (e.g. "mdi:eraser")

    async def async_press(self) -> None:
        """Update."""
        await self.coordinator.update_data()
