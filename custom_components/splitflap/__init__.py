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

from .const import DOMAIN, FRONTEND_URL_PATH, FRONTEND_VERSION, PLATFORMS
from .coordinator import SplitFlapCoordinator

_LOGGER = logging.getLogger(__name__)

SERVICE_SEND_TEXT = "send_text"
SERVICE_SYNC = "sync"
SERVICE_SCAN = "scan"
SERVICES = (SERVICE_SEND_TEXT, SERVICE_SYNC, SERVICE_SCAN)

ATTR_TEXT = "text"
ATTR_START = "start"

SEND_TEXT_SCHEMA = vol.Schema(
    {
        vol.Required(ATTR_TEXT): cv.string,
        vol.Optional(ATTR_START, default=1): vol.All(
            vol.Coerce(int), vol.Range(min=1, max=9999)
        ),
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

    entry.async_on_unload(entry.add_update_listener(async_reload_entry))

    return True


async def async_reload_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Reload config entry on options update."""
    await hass.config_entries.async_reload(entry.entry_id)


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a SplitFlap config entry."""
    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unload_ok:
        coordinator: SplitFlapCoordinator | None = hass.data[DOMAIN].pop(
            entry.entry_id, None
        )
        if coordinator is not None:
            await coordinator.async_unload()

        if not _get_coordinators(hass):
            _async_unregister_services(hass)

    return unload_ok


async def _async_register_frontend(hass: HomeAssistant) -> None:
    """Register custom Lovelace card static path and extra js url."""
    if hass.data[DOMAIN].get("_frontend_registered"):
        return

    card_dir = os.path.join(os.path.dirname(__file__), "frontend")
    card_path = os.path.join(card_dir, "splitflap-card.js")
    card_url = f"{FRONTEND_URL_PATH}?v={FRONTEND_VERSION}"

    if not os.path.exists(card_path):
        _LOGGER.error("SplitFlap card file not found: %s", card_path)
        return

    try:
        try:
            from homeassistant.components.http import StaticPathConfig

            await hass.http.async_register_static_paths(
                [StaticPathConfig(FRONTEND_URL_PATH, card_path, cache_headers=False)]
            )
        except (ImportError, AttributeError):
            if hasattr(hass.http, "register_static_path"):
                hass.http.register_static_path(
                    FRONTEND_URL_PATH, card_path, cache_headers=False
                )
            else:
                _LOGGER.warning("Could not register static path for SplitFlap card.")
                return

        add_extra_js_url(hass, card_url)
        hass.data[DOMAIN]["_frontend_registered"] = True
        _LOGGER.debug("Registered SplitFlap card at %s", card_url)
    except Exception as err:  # noqa: BLE001 - never fail setup because of the card
        _LOGGER.warning("Could not auto-register SplitFlap frontend card: %s", err)


def _get_coordinators(hass: HomeAssistant) -> list[SplitFlapCoordinator]:
    """Return all loaded SplitFlap coordinators."""
    return [
        value
        for value in hass.data.get(DOMAIN, {}).values()
        if isinstance(value, SplitFlapCoordinator)
    ]


def _async_register_services(hass: HomeAssistant) -> None:
    """Register domain-level services for automations and scripts."""
    if not hass.services.has_service(DOMAIN, SERVICE_SEND_TEXT):

        async def handle_send_text(call: ServiceCall) -> None:
            """Handle send_text service."""
            text = call.data[ATTR_TEXT]
            start = call.data.get(ATTR_START, 1)
            for coordinator in _get_coordinators(hass):
                await coordinator.send_text(text, start=start)

        hass.services.async_register(
            DOMAIN, SERVICE_SEND_TEXT, handle_send_text, schema=SEND_TEXT_SCHEMA
        )

    if not hass.services.has_service(DOMAIN, SERVICE_SYNC):

        async def handle_sync(call: ServiceCall) -> None:
            """Handle sync service."""
            for coordinator in _get_coordinators(hass):
                await coordinator.fetch_esp32_data()

        hass.services.async_register(DOMAIN, SERVICE_SYNC, handle_sync)

    if not hass.services.has_service(DOMAIN, SERVICE_SCAN):

        async def handle_scan(call: ServiceCall) -> None:
            """Handle scan service."""
            for coordinator in _get_coordinators(hass):
                await coordinator.trigger_bus_scan()

        hass.services.async_register(DOMAIN, SERVICE_SCAN, handle_scan)


def _async_unregister_services(hass: HomeAssistant) -> None:
    """Remove domain services when the last config entry is unloaded."""
    for service in SERVICES:
        if hass.services.has_service(DOMAIN, service):
            hass.services.async_remove(DOMAIN, service)
