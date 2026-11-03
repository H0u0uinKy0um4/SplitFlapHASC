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
│   ├── ADDING_FEATURES.md        # Plain-language guide for human owners to add features
│   └── CALIBRATION.md            # Calibration model, fitting algorithm and verification steps
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

### 5. Calibration Model

Calibration spans three layers (slave firmware &rarr; ESP32 master &rarr; this
integration). The model below is a deliberate design decision. Read it before
changing anything that moves a module or writes `home_offset` /
`positions`. The full rationale, fitting algorithm and verification procedure
live in [docs/CALIBRATION.md](docs/CALIBRATION.md).

#### Coordinate system (single source of truth: slave firmware)

- `pos` = half-steps counted **from the hall edge**, modulo `N`
  (`N = stepsPerRev`). The origin is the hall edge, **not flap 0**.
- On every hall edge the slave sets `pos = 0`. This is the only drift
  correction that exists and it is mandatory. `4096` is only a nominal value;
  real mechanics differ, and without re-anchoring the error accumulates every
  revolution.
- `homeOffset` = the `pos` at which flap 0 is centred. It is one number,
  **not** a coordinate system. Changing it must never move the map.
- `map[i]` = the `pos` at which flap i is centred, recorded while the user
  aligns it. `0xFFFF` means unset &rarr; fallback
  `homeOffset + round(i * N / FLAP_COUNT)`.

Why: the previous design put the origin at flap 0, so every `homeOffset`
change moved the whole coordinate system and the map had to be re-projected by
the same delta inside Home Assistant. That re-projection used a cached map and
corrupted calibration whenever a refresh was missed. Origin at the hall edge
removes the coupling entirely.

#### Hard rules

1. Coordinate math lives in **one** layer: the slave. Master and HA forward
   values; they never re-project them.
2. Never shift, rebase or recompute map entries in `coordinator.py` or the
   card. The only map operations are "record current pos for index i",
   "write map", "clear map".
3. `currentFlapIndex` does not exist in the protocol. Derive the index from
   `pos` + `map`; a second source of truth only drifts and already caused a
   bug where the `g` command left it stale.
4. Motion is always forward. Backwards motion changes backlash direction and
   invalidates recorded measurements. A "nudge left" simply takes the long way
   around.
5. A move that cannot reach its target within `N + margin` steps must stop and
   mark the position unknown. Never silently claim success.
6. The slave does not report calibration errors to HA. It reports `pos` and
   `busy`; a mechanical fault is only observable at the hall edge and is a
   diagnostic, not a control input.

#### Fitting the map (only when a map is actually needed)

Never store raw user observations. Separate systematic mechanical error from
observer noise:

1. Unwrap `(index, pos)` samples into a monotonically increasing sequence.
2. Robust line fit `pos_i = a + P*i` (Theil&ndash;Sen, then MAD outlier
   rejection). `P` also yields `N_fit = round(FLAP_COUNT * P)`, which is more
   accurate than counting hall edges.
3. Model the residuals: low-order Fourier series (K=1..2) when the error is
   smooth around the drum (eccentricity), per-flap medians when every flap
   differs (hand-applied flaps).
4. Enforce circular gaps `g_i > 0`; a non-positive gap means flaps overlap
   mechanically and no map can fix it.
5. Emit `map[i]`, `homeOffset = map[0]`, optionally `stepsPerRev = N_fit`.

Skip the map entirely when max `|residual|` is under ~10 steps: at ~64
steps/flap that is less than a quarter flap and is not visible.

The fit is a pure, dependency-free function and belongs in Home Assistant
(`custom_components/splitflap/calibration.py`), not in ATtiny firmware. The
slave only stores the resulting map, so the display keeps working without HA.
Keep the existing wire format for the map in the `m<id>d` response
(`"index=pos,index=pos,..."`) so the master and card do not need to change for
a firmware-only update.

The slave exposes the live state separately so `d` stays backward compatible:

- `m<id>s` &rarr; `m<id>s:<pos>:<busy>:<position_known>`
- `m<id>r<index>` records the current `pos` as `map[index]` (index 0 also
  sets `homeOffset`)

The authoritative command reference lives in
`SplFlp_Slave_Attiny/PROTOCOL.md`.

#### Current status (update this checklist when the code changes)

Implemented in `SplFlp_Slave_Attiny` (see its `PROTOCOL.md`):

- [x] Slave: coordinate origin at the hall edge + re-anchor on every entering
      edge inside the step loop.
- [x] Slave: non-blocking motion. `update()` advances one half-step per
      millisecond, so the RS485 parser keeps running during moves.
- [x] Slave: `currentFlapIndex` removed; the index is derived from `pos` +
      `map` when needed.
- [x] Slave: `c` stores `countPerRev()` (blocking diagnostic, consistent
      entering-edge definition).
- [x] Slave: state query `m<id>s` reports `pos`, `busy` and `position_known`.
      `m<id>d` keeps its old config+map wire format.
- [x] Slave: `m<id>r<index>` records the current `pos` as `map[index]`;
      index 0 also sets `homeOffset`.
- [x] Slave: legacy maps (stored relative to flap 0) migrated once by adding
      `homeOffset`; format version tagged at EEPROM address 204.
- [x] Slave: failed/unreachable moves stop, mark the position unknown and
      never report success.
- [x] Master: query `s` and publish `current_step`, `busy` and
      `position_known`.
- [x] Master: poll `s` per module after movement instead of fixed refresh
      timers; validate the module id on every response.
- [x] HA/coordinator: `record` action, map shift removed, `busy` /
      `position_known` forwarded, fallback includes `home_offset`.
- [x] HA/card: board calibration rebuilt on `step` + `record`; per-module panel
      shows live state and records the current position.
- [ ] HA: optional `fit_drum()` (Theil&ndash;Sen + Fourier residual fit) once
      enough recorded flaps exist. Direct `record` is the supported flow today.
- [ ] Master: ACK/busy instead of polling timeouts (works today, but polling
      still uses fixed `STATE_TIMEOUT_MS`).

#### Known pitfalls (verify before trusting old calibration)

- Polling a moving module works because the slave services RS485 during motion,
  but `STATE_TIMEOUT_MS` must stay short enough not to stall the MQTT loop.
- `apply` is kept for compatibility and still writes exactly the supplied home
  offset and map entries. It must never shift or re-project existing entries.
- Old firmware maps were stored relative to flap 0. The slave migrates them
  once by adding `homeOffset`; do not repeat that shift in HA or the card.
- `SplFlp_Slave_Attiny` used to be outside git. It is a git repository now;
  keep firmware history there.

For human-friendly recipes and worked examples, see [docs/ADDING_FEATURES.md](docs/ADDING_FEATURES.md).

