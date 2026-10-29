# SplitFlap Home Assistant Integration & Lovelace Card

[![hacs_badge](https://img.shields.io/badge/HACS-Custom-41BDF5.svg)](https://github.com/hacs/default)

A complete Home Assistant integration and interactive Lovelace card for DIY RS485 Split-Flap displays powered by ESP32 and MQTT.

---

## Features

- **Full HACS Support**: Install directly via HACS as a Custom Integration.
- **UI Config Flow**: Easily configure topic prefixes directly in Home Assistant (Settings &rarr; Devices & Services &rarr; Add Integration &rarr; SplitFlap).
- **Auto-Discovered Device**: Master ESP32 and entities automatically grouped into a single SplitFlap device.
- **Interactive Split-Flap Lovelace Card**:
  - Authentic split-flap letter tiles.
  - Responsive tiles and labels that scale with the number of modules.
  - One tile per module, linked to that module's own entity.
  - Click a module tile to open its Home Assistant more-info dialog with the
    drum/flap list, current step, homing settings, position map and any other
    module-specific diagnostics.
  - Live module status display (module ID, flap character, state).
  - Quick text input with `Enter` key support.
  - Bus scan & module sync triggers with inline error feedback.
- **Home Assistant Services**:
  - `splitflap.send_text`: Send strings to the display.
  - `splitflap.sync`: Request the ESP32 to publish current module flaps and state.
  - `splitflap.scan`: Trigger an RS485 bus scan to detect connected modules.
- **Entities Provided**:
  - `text.splitflap_display_text`: Display text input.
  - `sensor.splitflap_master_status`: Master ESP32 connection state (`online`, `offline`).
  - `sensor.splitflap_detected_modules`: Total module count with per-module flap attributes.
  - `sensor.splitflap_module_<id>`: One entity per detected module. State is the
    current flap character; attributes include module state and position. These
    entities are created automatically as modules are discovered.
  - `button.splitflap_sync`: Fetch state and sync modules.
  - `button.splitflap_scan`: Trigger RS485 bus scan.

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
Each detected module is rendered from its own `sensor.splitflap_module_<id>` entity.
Clicking a module tile opens the module entity's more-info dialog.

### Card Configuration Example (YAML)

```yaml
type: custom:splitflap-card
title: SplitFlap Display
text_entity: text.splitflap_display_text
status_entity: sensor.splitflap_master_status
modules_sensor: sensor.splitflap_detected_modules
sync_entity: button.splitflap_sync
scan_entity: button.splitflap_scan
# Optional: explicitly select the module entities to display
# module_entities:
#   - sensor.splitflap_module_1
#   - sensor.splitflap_module_2
```

*(All entity fields are optional; sensible defaults are automatically resolved.
Module entities are discovered automatically from their `splitflap_module_id`
attribute.)*

---

## MQTT Topics & Protocol

| Topic | Direction | Payload Example | Purpose |
|---|---|---|---|
| `<prefix>/status` | ESP32 &rarr; HA | `{"state":"online","modules_count":3,"text":"TEST 123","modules":[{"id":1,"state":"idle","flap":"A"}]}` | State updates & module flaps |
| `<prefix>/command/display` | HA &rarr; ESP32 | `{"text":"HELLO"}` | Send string to display |
| `<prefix>/command/sync` | HA &rarr; ESP32 | `{"action":"fetch_state"}` | Request module and status report |
| `<prefix>/command/scan` | HA &rarr; ESP32 | `{"action":"scan"}` | Trigger RS485 address scan |

---

## Per-Module Diagnostics

Every module entity exposes its flap character as the entity state and the
remaining module data as attributes. Click a module tile in the card to open the
standard Home Assistant more-info dialog with all of them.

| Attribute | Description |
|---|---|
| `flap_list` | Ordered drum/flap characters (64 entries on the stock firmware). |
| `current_step` | Current motor position in half-steps. |
| `current_index` | Current flap index on the drum. |
| `auto_homing` | Whether automatic homing is enabled. |
| `home_offset` | Steps from the Hall sensor edge to flap 0. |
| `total_steps` | Total half-steps per revolution. |
| `map_of_positions` | Map of flap index to calibrated step position. |
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
      "current_step": 320,
      "current_index": 5,
      "auto_homing": true,
      "online": true,
      "home_offset": 2832,
      "total_steps": 4096,
      "map_of_positions": {"0": 0, "16": 1024, "32": 2048, "48": 3072}
    }
  ]
}
```

The stock master firmware currently publishes representative diagnostics for
its placeholder modules. Replace those values with the slave responses to
`m<id>d` (configuration/map) and `m<id>l` (drum) when the RS485 polling is wired
up.

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
