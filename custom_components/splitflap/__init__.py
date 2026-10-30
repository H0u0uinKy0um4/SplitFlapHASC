"""The SplitFlap Display integration."""
from __future__ import annotations

import logging
import os
from typing import Any

from homeassistant.components.frontend import add_extra_js_url
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from .const import DOMAIN, FRONTEND_URL_PATH, FRONTEND_VERSION, PLATFORMS
from .coordinator import SplitFlapCoordinator
from .services import (
    SERVICE_SCAN,
    SERVICE_SEND_TEXT,
    SERVICE_SYNC,
    SERVICES,
    async_register_services,
    async_unregister_services,
    get_coordinators,
)

_LOGGER = logging.getLogger(__name__)

# Keep backward-compatible alias
_get_coordinators = get_coordinators


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
    async_register_services(hass)

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

        if not get_coordinators(hass):
            async_unregister_services(hass)

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
