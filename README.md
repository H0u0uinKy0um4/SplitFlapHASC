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
  - Click a module tile to open its Home Assistant more-info dialog.
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
