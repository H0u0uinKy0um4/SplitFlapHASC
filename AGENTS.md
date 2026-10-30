# AGENTS.md

Guidance and architecture reference for AI agents working in this repository.

## Repository Layout

```
.
├── custom_components/
│   └── splitflap/
│       ├── __init__.py           # Integration lifecycle (setup, unload, card registration)
│       ├── button.py             # All button entities & button registration
│       ├── config_flow.py        # UI config flow and options flow
│       ├── const.py              # Domain constants, version strings, platforms
│       ├── coordinator.py        # SplitFlapCoordinator: MQTT pub/sub, data normalization
│       ├── frontend/
│       │   └── splitflap-card.js # Custom Lovelace card (vanilla Web Component)
│       ├── manifest.json         # Home Assistant integration manifest
│       ├── sensor.py             # Status sensor, detected modules sensor, per-module sensors
│       ├── services.py           # All service handlers, schemas, and registration
│       ├── services.yaml         # Service metadata descriptions for Home Assistant UI
│       ├── strings.json          # Translation strings for config flow
│       ├── text.py               # Text entity for sending display messages
│       └── translations/
│           └── en.json           # English translation strings
├── docs/
│   └── ADDING_FEATURES.md        # Plain-language guide for human owners to add features
├── hacs.json                     # HACS custom repository configuration
└── README.md                     # User documentation and setup guide
```

## Architectural Conventions

### 1. Buttons (`button.py`)
- All buttons subclass `SplitFlapBaseButton` (which handles `CoordinatorEntity`, `_attr_has_entity_name`, `_attr_device_info`, and `_attr_unique_id = f"{coordinator.prefix}_{self.button_id}"`).
- To add a button:
  1. Define a subclass of `SplitFlapBaseButton` setting `button_id`, `_attr_name`, `_attr_icon`, and `async_press(self)`.
  2. Add the class to `BUTTON_CLASSES`.
- Never duplicate registration across multiple files.

### 2. Services (`services.py` & `services.yaml`)
- All services are declared in `services.py` via `ServiceDefinition(name, handler, schema=None)` and collected in the `SERVICES` list.
- Service handlers follow the signature `async def handle_<name>(call: ServiceCall, hass: HomeAssistant) -> None:`.
- `async_register_services(hass)` and `async_unregister_services(hass)` iterate over `SERVICES` automatically.
- Every service MUST have a corresponding documentation block in `services.yaml`.

### 3. State & MQTT Coordination (`coordinator.py`)
- `SplitFlapCoordinator` handles all communication with the hardware.
- Status updates arrive on `{prefix}/status`.
- Commands are published to `{prefix}/command/<display|sync|scan>`.
- Any new hardware interaction should be exposed as an async method on `SplitFlapCoordinator`.

### 4. Stability Constraints
- **Public Names**: Do not change entity IDs, unique IDs, service names, MQTT topics, or config entry keys.
- **Dependencies**: Keep the integration lightweight. Do not introduce external dependencies without strong justification.
- **Owner Guide**: When altering button or service patterns, always keep `docs/ADDING_FEATURES.md` in sync.

For human-friendly recipes and worked examples, see [docs/ADDING_FEATURES.md](docs/ADDING_FEATURES.md).
