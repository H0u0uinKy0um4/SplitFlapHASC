"""The SplitFlap Display integration."""
from __future__ import annotations

import logging
import os
from typing import Any

from homeassistant.components.frontend import add_extra_js_url
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.helpers import config_validation as cv
import voluptuous as vol

from .const import DOMAIN, PLATFORMS
from .coordinator import SplitFlapCoordinator

_LOGGER = logging.getLogger(__name__)

SERVICE_SEND_TEXT = "send_text"
SERVICE_SYNC = "sync"
SERVICE_SCAN = "scan"

ATTR_TEXT = "text"

SEND_TEXT_SCHEMA = vol.Schema(
    {
        vol.Required(ATTR_TEXT): cv.string,
    }
)


async def async_setup(hass: HomeAssistant, config: dict[str, Any]) -> bool:
    """Set up the SplitFlap component."""
    hass.data.setdefault(DOMAIN, {})
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up SplitFlap from a config entry."""
    hass.data.setdefault(DOMAIN, {})

    coordinator = SplitFlapCoordinator(hass, entry)
    await coordinator.async_setup()

    hass.data[DOMAIN][entry.entry_id] = coordinator

    # Register frontend card automatically
    await _async_register_frontend(hass)

    # Register platforms
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    # Register custom domain services if not already registered
    _async_register_services(hass)

    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a SplitFlap config entry."""
    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unload_ok:
        coordinator: SplitFlapCoordinator = hass.data[DOMAIN].pop(entry.entry_id)
        await coordinator.async_unload()

    return unload_ok


async def _async_register_frontend(hass: HomeAssistant) -> None:
    """Register custom Lovelace card static path and extra js url."""
    if hass.data[DOMAIN].get("_frontend_registered"):
        return

    card_dir = os.path.join(os.path.dirname(__file__), "frontend")
    card_path = os.path.join(card_dir, "splitflap-card.js")
    card_url = "/splitflap/splitflap-card.js"

    if os.path.exists(card_path):
        try:
            await hass.http.async_register_static_paths([
                hass.http.StaticPathConfig(card_url, card_path, cache_headers=False)
            ])
        except AttributeError:
            # Fallback for older Home Assistant versions
            hass.http.register_static_path(card_url, card_path, cache_headers=False)

        add_extra_js_url(hass, card_url)
        _LOGGER.debug("Registered SplitFlap card at %s", card_url)

    hass.data[DOMAIN]["_frontend_registered"] = True


def _async_register_services(hass: HomeAssistant) -> None:
    """Register domain-level services for automations and scripts."""
    if hass.services.has_service(DOMAIN, SERVICE_SEND_TEXT):
        return

    async def handle_send_text(call: ServiceCall) -> None:
        """Handle send_text service."""
        text = call.data[ATTR_TEXT]
        coordinators = [
            c for k, c in hass.data[DOMAIN].items() if isinstance(c, SplitFlapCoordinator)
        ]
        for coordinator in coordinators:
            await coordinator.send_text(text)

    async def handle_sync(call: ServiceCall) -> None:
        """Handle sync service."""
        coordinators = [
            c for k, c in hass.data[DOMAIN].items() if isinstance(c, SplitFlapCoordinator)
        ]
        for coordinator in coordinators:
            await coordinator.fetch_esp32_data()

    async def handle_scan(call: ServiceCall) -> None:
        """Handle scan service."""
        coordinators = [
            c for k, c in hass.data[DOMAIN].items() if isinstance(c, SplitFlapCoordinator)
        ]
        for coordinator in coordinators:
            await coordinator.trigger_bus_scan()

    hass.services.async_register(
        DOMAIN, SERVICE_SEND_TEXT, handle_send_text, schema=SEND_TEXT_SCHEMA
    )
    hass.services.async_register(DOMAIN, SERVICE_SYNC, handle_sync)
    hass.services.async_register(DOMAIN, SERVICE_SCAN, handle_scan)
