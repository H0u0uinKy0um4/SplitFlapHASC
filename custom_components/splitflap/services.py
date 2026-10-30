"""Service implementations and registration for SplitFlap."""
from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
import logging

from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.helpers import config_validation as cv
import voluptuous as vol

from .const import DOMAIN
from .coordinator import SplitFlapCoordinator

_LOGGER = logging.getLogger(__name__)

# Service names
SERVICE_SEND_TEXT = "send_text"
SERVICE_SYNC = "sync"
SERVICE_SCAN = "scan"
SERVICE_SCAN = "update"

# Service parameters
ATTR_TEXT = "text"
ATTR_START = "start"

# Validation schemas
SEND_TEXT_SCHEMA = vol.Schema(
    {
        vol.Required(ATTR_TEXT): cv.string,
        vol.Optional(ATTR_START, default=1): vol.All(
            vol.Coerce(int), vol.Range(min=1, max=9999)
        ),
    }
)


def get_coordinators(hass: HomeAssistant) -> list[SplitFlapCoordinator]:
    """Return all loaded SplitFlap coordinators."""
    return [
        value
        for value in hass.data.get(DOMAIN, {}).values()
        if isinstance(value, SplitFlapCoordinator)
    ]


# =============================================================================
# SERVICE HANDLERS
# To add a new service:
# 1. Write an async handler function below (or copy an existing one).
# 2. Add a ServiceDefinition to the SERVICES list below.
# 3. Add documentation and UI fields in services.yaml.
# =============================================================================


async def handle_send_text(call: ServiceCall, hass: HomeAssistant) -> None:
    """Send text to all connected SplitFlap displays."""
    text = call.data[ATTR_TEXT]
    start = call.data.get(ATTR_START, 1)
    for coordinator in get_coordinators(hass):
        await coordinator.send_text(text, start=start)


async def handle_sync(call: ServiceCall, hass: HomeAssistant) -> None:
    """Request current state and module info from ESP32 master."""
    for coordinator in get_coordinators(hass):
        await coordinator.fetch_esp32_data()


async def handle_scan(call: ServiceCall, hass: HomeAssistant) -> None:
    """Trigger an RS485 bus scan on the ESP32 master."""
    for coordinator in get_coordinators(hass):
        await coordinator.trigger_bus_scan()

async def handle_update(call: ServiceCall, hass: HomeAssistant) -> None:
    """Update data"""
    for coordinator in get_coordinators(hass):
        await coordinator.update_data()


# =============================================================================
# SERVICE REGISTRATION
# Each service entry needs:
#   name: The service name (called in Home Assistant as splitflap.<name>)
#   handler: The async function above that executes the action
#   schema: (Optional) voluptuous schema if the service accepts parameters
# =============================================================================


@dataclass(frozen=True)
class ServiceDefinition:
    """Definition for a SplitFlap service."""

    name: str
    handler: Callable[[ServiceCall, HomeAssistant], Awaitable[None]]
    schema: vol.Schema | None = None


SERVICES: list[ServiceDefinition] = [
    ServiceDefinition(
        name=SERVICE_SEND_TEXT,
        handler=handle_send_text,
        schema=SEND_TEXT_SCHEMA,
    ),
    ServiceDefinition(
        name=SERVICE_SYNC,
        handler=handle_sync,
    ),
    ServiceDefinition(
        name=SERVICE_SCAN,
        handler=handle_scan,
    ),
    ServiceDefinition(
        name=SERVICE_UPDATE,
        handler=handle_update,
    ),
]


def _make_service_handler(
    handler: Callable[[ServiceCall, HomeAssistant], Awaitable[None]],
    hass: HomeAssistant,
) -> Callable[[ServiceCall], Awaitable[None]]:
    """Create a service call wrapper that passes hass to the handler."""

    async def _service_call(call: ServiceCall) -> None:
        await handler(call, hass)

    return _service_call


def async_register_services(hass: HomeAssistant) -> None:
    """Register all SplitFlap domain services."""
    for service_def in SERVICES:
        if not hass.services.has_service(DOMAIN, service_def.name):
            hass.services.async_register(
                DOMAIN,
                service_def.name,
                _make_service_handler(service_def.handler, hass),
                schema=service_def.schema,
            )
            _LOGGER.debug(
                "Registered SplitFlap service: %s.%s", DOMAIN, service_def.name
            )


def async_unregister_services(hass: HomeAssistant) -> None:
    """Unregister all SplitFlap domain services."""
    for service_def in SERVICES:
        if hass.services.has_service(DOMAIN, service_def.name):
            hass.services.async_remove(DOMAIN, service_def.name)
            _LOGGER.debug(
                "Unregistered SplitFlap service: %s.%s", DOMAIN, service_def.name
            )

