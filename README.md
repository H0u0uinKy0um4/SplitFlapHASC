# SplitFlap Home Assistant Integration & Lovelace Card

[![hacs_badge](https://img.shields.io/badge/HACS-Custom-41BDF5.svg)](https://github.com/hacs/default)

A complete Home Assistant integration and interactive Lovelace card for DIY RS485 Split-Flap displays powered by ESP32 and MQTT.

---

## Features

- **Full HACS Support**: Install directly via HACS as a Custom Integration.
- **UI Config Flow**: Easily configure topic prefixes directly in Home Assistant (Settings &rarr; Devices & Services &rarr; Add Integration &rarr; SplitFlap).
- **Auto-Discovered Device**: Master ESP32 and entities automatically grouped into a single SplitFlap device.
- **Last Known State**: module count, per-module stats/flaps and display text are
  persisted in Home Assistant storage and restored at startup, so the card and
  entities stay populated while the ESP32 is powered off. Master status correctly
  stays `offline` until fresh MQTT data arrives. Deleting the integration entry
  also deletes the saved snapshot.
- **Interactive Split-Flap Lovelace Card**:
  - Authentic split-flap letter tiles.
  - Responsive tiles and labels that scale with the number of modules.
  - One tile per module; tiles work with or without a per-module HA entity.
  - Click any tile to open an in-card module panel with state, position,
    drum/flap list, current step, homing settings, position map and any other
    module-specific diagnostics. A button opens the HA entity when one exists.
  - **Layout controls** in the card: set the number of columns (or auto-fit)
    and the tile width:height ratio, so boards with 20-100 modules stay usable.
    Settings are stored in the browser; `module_columns`, `module_ratio` and
    `module_gap` YAML options provide defaults.
  - **Start position targeting**: enter a start module and the text is written
    from that module onward (earlier modules are cleared).
  - Live module status display (module ID, flap character, state).
  - Quick text input with `Enter` key support.
  - Bus scan & module sync triggers with inline error feedback.
- **Home Assistant Services**:
  - `splitflap.send_text`: Send a string to the display. The integration
    converts it into an explicit character target for every known module,
    optionally starting at a specific module position with `start`.
  - `splitflap.sync`: Request the ESP32 to publish current module flaps and state.
  - `splitflap.scan`: Discover modules by scanning every possible RS485 id
    (1-255). This replaces the known module list, so use it after adding or
    removing hardware.
  - `splitflap.update`: Refresh flaps and diagnostics for the modules that are
    already known. Much faster than a full scan; it never adds or removes
    modules.
  - `splitflap.calibrate`: Drive one module and persist calibration data.
    Actions: `goto` (move to a flap index), `home`, `apply` (write home offset
    and position-map entries), `clear_map`, and `refresh`.
- **Entities Provided**:
  - `text.splitflap_display_text`: Display text input.
  - `sensor.splitflap_master_status`: Master ESP32 connection state (`online`, `offline`).
  - `sensor.splitflap_detected_modules`: Total module count with per-module flap attributes.
  - `sensor.splitflap_module_<id>`: One entity per detected module. State is the
    current flap character; attributes include module state and position. These
    entities are created automatically as modules are discovered.
  - `button.splitflap_sync`: Fetch state and sync modules.
  - `button.splitflap_scan`: Discover modules with a full RS485 bus scan.
  - `button.splitflap_update`: Update the modules that are already known.

---

## Installation via HACS

1. In Home Assistant, open **HACS** &rarr; **Integrations**.
2. Click the three dots in the top right &rarr; **Custom repositories**.
3. Add this repository URL, select category **Integration**, and click **Add**.
4. Click **Download** on the SplitFlap integration.
5. Restart Home Assistant.
6. Go to **Settings** &rarr; **Devices & Services** &rarr; **Add Integration**, search for **SplitFlap**, and enter your MQTT topic prefix (default: `splitflap`).

---

## Lovelace Card

The Lovelace card is automatically served by the integration at `/splitflap/splitflap-card.js`.

The card automatically discovers the entities belonging to the SplitFlap device.
Each detected module is rendered as its own tile. Per-module HA entities are
optional: the card can render and inspect modules directly from the aggregate
`Detected Modules` sensor, so it keeps working even when you disable the
per-module sensor entities. Clicking a module tile opens the in-card module
panel. Use the gear button to change columns / tile ratio for larger displays.

The card exposes two refresh actions:

- **Update Current** refreshes flaps and diagnostics for modules the firmware
  already knows about. It is fast and does not change the module list.
- **Discover** scans every possible RS485 id (1-255). Use it after adding or
  removing hardware; the scan replaces the known module list.

A board that reports zero modules renders no tiles, so an empty or
disconnected board no longer shows placeholder flaps.

### Calibrating a module

Click a module tile, then **Calibrate** in its details panel:

1. Choose an **Expected flap** and press **Send expected**. Wait until the reel
   has physically stopped.
2. Compare the physical flap with the expected one, select the **Actual flap**
   on the reel, and press **Record pair**.
3. Repeat with flaps spread across the drum (for example 0, 8, 16, 24, 32, 40,
   48, 56). More samples give a better result.
4. The card shows the proposed home offset and any per-flap position-map
   entries. Press **Apply calibration**; the module re-homes with the new
   offset and then reports its updated diagnostics.

The global home-offset correction is the median signed flap error across all
samples. Any remaining error for an individual flap becomes a position-map
entry. Residuals smaller than half a flap are ignored. Existing map entries for
flaps that were not sampled are preserved; **Clear position map** removes them
all.

This workflow uses the module's existing RS485 command set, so no slave
reflash is required. The updated master firmware is required.

### Card Configuration Example (YAML)

```yaml
type: custom:splitflap-card
title: SplitFlap Display
text_entity: text.splitflap_display_text
status_entity: sensor.splitflap_master_status
modules_sensor: sensor.splitflap_detected_modules
sync_entity: button.splitflap_sync
scan_entity: button.splitflap_scan
update_entity: button.splitflap_update
# Optional layout defaults (the gear button overrides and saves them locally)
module_columns: 0      # 0 = auto-fit; e.g. 50 wraps a 100-module board into 2 rows
module_ratio: "38:52"  # tile width:height, or a number such as 0.73
module_gap: 6          # tile gap in pixels
# Optional: explicitly select the module entities to display
# module_entities:
#   - sensor.splitflap_module_1
#   - sensor.splitflap_module_2
```

*(All entity fields are optional; sensible defaults are automatically resolved.
Module entities are discovered automatically from their `splitflap_module_id`
attribute, but are only used to enrich the in-card panel when available.)*

---

## MQTT Topics & Protocol

| Topic | Direction | Payload Example | Purpose |
|---|---|---|---|
| `<prefix>/status` | ESP32 &rarr; HA | `{"state":"online","modules_count":3,"text":"TEST 123","modules":[{"id":1,"state":"idle","flap":"A","flap_list":" ABC...","map_of_positions":"0=0,16=1024"}]}` | State updates, module diagnostics and flap arrays |
| `<prefix>/command/display` | HA &rarr; ESP32 | `{"modules":[{"id":1,"char":"H"},{"id":2,"char":"E"},{"id":3,"char":"L"},{"id":4,"char":"L"},{"id":5,"char":"O"}]}` | Set the character for every module |
| `<prefix>/command/sync` | HA &rarr; ESP32 | `{"action":"fetch_state"}` | Request module and status report |
| `<prefix>/command/scan` | HA &rarr; ESP32 | `{"action":"scan"}` | Trigger RS485 address scan |

The display command contains one entry per detected module. Some examples:

```json
{
  "modules": [
    {"id": 1, "char": "H"},
    {"id": 2, "char": "E"},
    {"id": 3, "char": "L"},
    {"id": 4, "char": "L"},
    {"id": 5, "char": "O"},
    {"id": 6, "char": " "}
  ]
}
```

Modules before the requested start position and modules beyond the text get a
space, so they show a blank flap. The ESP32 master forwards each entry to the
matching RS485 module as `m<id>-<char>`.

To write to a specific part of the display from an automation, use the optional
`start` field (1-based module position):

```yaml
service: splitflap.send_text
data:
  text: "HELLO"
  start: 5
```

---

## Per-Module Diagnostics

When a module entity exists, it exposes its flap character as the entity state
and the remaining module data as attributes. Click a module tile in the card to
open the in-card module panel with all of them (no entity is required for this).
If the module has an entity, the panel also offers an **Open entity** button for
the standard Home Assistant more-info dialog.

Home Assistant is the source of truth for the displayed character: the
integration maps the text it last sent onto the modules, so a firmware restart
or a stale `flap` field cannot change what the entities/card show. The flap
index and step position are then derived from the module's flap array and
position map.

| Attribute | Description |
|---|---|
| `flap` | Character Home Assistant dictated for this module (authoritative). |
| `flap_index` | 0-based flap index of `flap` in the module's flap array. |
| `flap_position` | Step position for that flap, from the position map or the same fallback the slave uses. |
| `flap_list` | FlapArray: ordered drum/flap characters (64 entries on the stock firmware). |
| `map_of_positions` | PositionMap: flap index to calibrated step position for offsets that are set. |
| `current_step` | Current motor position in half-steps, when reported by firmware. |
| `current_index` | Current flap index on the drum, when reported by firmware. |
| `auto_homing` | Whether automatic homing is enabled. |
| `home_offset` | Steps from the Hall sensor edge to flap 0. |
| `total_steps` | Total half-steps per revolution. |
| `online` | Whether the module is currently responding. |
| `last_seen` | Optional last-seen timestamp/value from the firmware. |
| `extra_stats` | Any additional firmware-specific fields not listed above. |

The integration accepts snake_case, camelCase and PascalCase field names, so
`current_step`, `currentStep`, `CurrentStep` and `currentStepPos` all work. The
stats may also be nested in a `stats`, `config`, `details` or `module_stats`
object inside each module entry.

Example status payload:

```json
{
  "state": "online",
  "text": "HELLO",
  "modules_count": 1,
  "modules": [
    {
      "id": 1,
      "state": "idle",
      "flap": "H",
      "flap_list": " ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$&()-+=;q:%'.,/?*roygbpw",
      "auto_homing": true,
      "online": true,
      "home_offset": 2832,
      "total_steps": 4096,
      "map_of_positions": "0=0,16=1024,32=2048,48=3072"
    }
  ]
}
```

The stock master firmware fills these fields by querying each slave with
`m<id>d` (configuration and position map) and `m<id>l` (64-character drum) at
boot and during a bus scan. `flap_list` and `map_of_positions` then appear in the
module's more-info dialog and in the card's module panel.

---

## Customization & Adding Features

Want to add your own custom buttons (e.g. Clear Display, Reset) or backend services for automations?
See the beginner-friendly step-by-step guide:
- [Adding Features Guide (No Python needed)](docs/ADDING_FEATURES.md)

For AI agents working on this codebase:
- [Agent Reference & Architecture](AGENTS.md)

---

## Troubleshooting

### `Platform mqtt does not generate unique IDs`

This warning means two retained MQTT discovery payloads share the same
`unique_id`. Older SplitFlap firmware published a second discovery config to
`homeassistant/device/splflp_master/config` using the same
`splflp_master_status` ID as `homeassistant/sensor/splflp_master_status/config`.

The current firmware deletes the obsolete retained topic on every MQTT connect
and disables firmware-side discovery by default, because this integration owns
all entities. Flash the updated firmware, then remove the leftover entity once:

1. Delete the retained discovery topics in your broker (replace the credentials):

   ```bash
   mosquitto_pub -h <broker> -u <user> -P <password> \
     -r -n -t "homeassistant/device/splflp_master/config"
   mosquitto_pub -h <broker> -u <user> -P <password> \
     -r -n -t "homeassistant/sensor/splflp_master_status/config"
   ```

   The `-r -n` combination publishes an empty retained payload, which removes
   the retained message.

2. In Home Assistant, go to **Settings &rarr; Devices & Services &rarr; Entities**,
   filter for `splflpmaster_status` or `splitflap_status`, and delete any orphaned
   entity that is no longer provided by the integration.

3. Restart Home Assistant. The integration's entities
   (`sensor.splitflap_master_status`, `sensor.splitflap_detected_modules` and one
   `sensor.splitflap_module_<id>` per module) are now the only SplitFlap entities.

To use firmware-side discovery *without* the integration, add
`-DSPLFLAP_ENABLE_MQTT_DISCOVERY=1` to `build_flags` in the master firmware's
`platformio.ini`.
