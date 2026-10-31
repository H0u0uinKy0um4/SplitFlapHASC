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
SERVICE_UPDATE = "update"
SERVICE_CALIBRATE = "calibrate"

# Service parameters
ATTR_TEXT = "text"
ATTR_START = "start"
ATTR_MODULE_ID = "module_id"
ATTR_ACTION = "action"
ATTR_INDEX = "index"
ATTR_FLAP = "flap"
ATTR_HOME_OFFSET = "home_offset"
ATTR_POSITIONS = "positions"

CALIBRATION_ACTIONS = ("goto", "home", "apply", "clear_map", "refresh")

POSITIONS_SCHEMA = vol.Schema(
    {
        cv.string: vol.All(vol.Coerce(int), vol.Range(min=0, max=65535)),
    }
)

CALIBRATE_SCHEMA = vol.Schema(
    {
        vol.Required(ATTR_ACTION): vol.In(CALIBRATION_ACTIONS),
        vol.Required(ATTR_MODULE_ID): vol.All(
            vol.Coerce(int), vol.Range(min=1, max=255)
        ),
        vol.Optional(ATTR_INDEX): vol.All(
            vol.Coerce(int), vol.Range(min=0, max=63)
        ),
        vol.Optional(ATTR_FLAP): cv.string,
        vol.Optional(ATTR_HOME_OFFSET): vol.All(
            vol.Coerce(int), vol.Range(min=0, max=65535)
        ),
        vol.Optional(ATTR_POSITIONS): POSITIONS_SCHEMA,
    }
)

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
    """Request quick data update from ESP32 master."""
    for coordinator in get_coordinators(hass):
        await coordinator.update_data()


async def handle_calibrate(call: ServiceCall, hass: HomeAssistant) -> None:
    """Drive and persist module calibration commands."""
    data = call.data
    for coordinator in get_coordinators(hass):
        await coordinator.calibrate_module(
            module_id=data[ATTR_MODULE_ID],
            action=data[ATTR_ACTION],
            index=data.get(ATTR_INDEX),
            flap=data.get(ATTR_FLAP),
            home_offset=data.get(ATTR_HOME_OFFSET),
            positions=data.get(ATTR_POSITIONS),
        )


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
    ServiceDefinition(
        name=SERVICE_CALIBRATE,
        handler=handle_calibrate,
        schema=CALIBRATE_SCHEMA,
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
