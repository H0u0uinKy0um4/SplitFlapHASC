# Adding Features to SplitFlap: A Beginner's Guide

This guide is written for you to add new **Buttons** and **Services** to your SplitFlap integration on your own, using only a text editor and Home Assistant. No prior Python programming knowledge is required.

---

## 1. Map of the Project

Every file in the project has one specific job. Here is where everything lives:

- `custom_components/splitflap/button.py`: Edit this file when you want to add, edit, or remove clickable button entities in Home Assistant.
- `custom_components/splitflap/services.py`: Edit this file when you want to add, edit, or remove backend services (actions you can run from automations, scripts, or Developer Tools).
- `custom_components/splitflap/services.yaml`: Edit this file when you want to describe a service so Home Assistant displays friendly names, descriptions, and input boxes in the UI.
- `custom_components/splitflap/coordinator.py`: Edit this file when you want to change how Home Assistant communicates with your ESP32 over MQTT (sending commands or receiving status).
- `custom_components/splitflap/sensor.py`: Edit this file when you want to change or add status sensors (like master status or per-module character sensors).
- `custom_components/splitflap/text.py`: Edit this file when you want to modify the text input entity in Home Assistant.
- `custom_components/splitflap/const.py`: Edit this file when you want to change integration constants (like domain name or default prefixes).
- `custom_components/splitflap/config_flow.py`: Edit this file when you want to change the initial setup wizard or options dialog in Home Assistant.
- `custom_components/splitflap/__init__.py`: Edit this file when you want to change how the integration loads and unloads inside Home Assistant.
- `custom_components/splitflap/frontend/splitflap-card.js`: Edit this file when you want to modify the design, layout, or tiles of the custom Lovelace card.
- `README.md`: Edit this file when you want to update documentation for users installing the integration.

---

## 2. Minimal Python Survival Notes

You do not need to learn Python. You just need to follow these four golden rules when editing files:

1. **Indentation (Spacing)**:
   - Python does not use curly brackets `{}` to group code; it uses spaces.
   - Always indent with **4 spaces** per level.
   - Never use the `Tab` key (or make sure your text editor is set to insert 4 spaces when pressing `Tab`).
   - Keep all lines inside a block aligned to the exact same column.

2. **Quotes**:
   - Text values must be wrapped in matching quotes: `"like this"` or `'like this'`.
   - Never leave a quote unclosed (e.g. `"missing quote`).

3. **Commas in Lists**:
   - When items are listed inside square brackets `[ ... ]`, separate each item with a comma `,`.
   - Putting a comma after the last item is totally fine and recommended.

4. **Names**:
   - Python names cannot have spaces.
   - Class names use CamelCase (e.g. `SplitFlapClearButton`).
   - Variable and ID names use lowercase letters with underscores (e.g. `clear_display`).

### What a Typo Looks Like in Home Assistant Logs:
- `IndentationError: unexpected indent`: One of your lines has too many or too few spaces at the beginning.
- `SyntaxError: invalid syntax`: You might have forgotten a comma `,`, a colon `:`, or closed a quote `"` incorrectly.
- `NameError: name '...' is not defined`: You misspelled a name or referenced something before creating it.

---

## 3. Recipe: Add a New Button

A **Button** is an entity that appears on your SplitFlap device page in Home Assistant (e.g. `button.splitflap_sync`). When you press it, it runs an action.

### File to edit:
`custom_components/splitflap/button.py`

### Step 1: Copy the Template
Open `custom_components/splitflap/button.py`. Scroll down to the `# BUTTON DEFINITIONS` section. Copy the block below and paste it directly after the existing buttons:

```python
class SplitFlapCHANGE_MEButton(SplitFlapBaseButton):
    """Button to CHANGE_ME."""

    button_id = "CHANGE_ME"          # Lowercase unique suffix (e.g. "clear"). Creates entity button.<device>_clear
    _attr_name = "CHANGE_ME"         # Name shown in Home Assistant UI (e.g. "Clear Display")
    _attr_icon = "mdi:CHANGE_ME"     # Icon from materialdesignicons.com (e.g. "mdi:eraser")

    async def async_press(self) -> None:
        """Action performed when button is pressed."""
        await self.coordinator.CHANGE_ME()
```

Replace the `CHANGE_ME` placeholders:
- `SplitFlapCHANGE_MEButton` &rarr; e.g. `SplitFlapClearButton`
- `button_id = "CHANGE_ME"` &rarr; e.g. `button_id = "clear"` (lowercase, no spaces)
- `_attr_name = "CHANGE_ME"` &rarr; e.g. `_attr_name = "Clear Display"`
- `_attr_icon = "mdi:CHANGE_ME"` &rarr; e.g. `_attr_icon = "mdi:eraser"` (any icon from [Material Design Icons](https://pictogrammers.com/library/mdi/))
- `await self.coordinator.CHANGE_ME()` &rarr; the coordinator action to run (e.g. `await self.coordinator.send_text("")` to blank the display, or `await self.coordinator.fetch_esp32_data()`).

### Step 2: Register the Button
In the same file (`custom_components/splitflap/button.py`), find the `BUTTON_CLASSES` list near the bottom. Add your new class name to the list:

```python
BUTTON_CLASSES: list[type[SplitFlapBaseButton]] = [
    SplitFlapSyncButton,
    SplitFlapScanButton,
    SplitFlapCHANGE_MEButton,  # <-- Add your new button class here
]
```

### Checklist for Adding a Button:
- [x] **`custom_components/splitflap/button.py`** (*Required*): Paste the button class and add its name to `BUTTON_CLASSES`.
- [ ] **`custom_components/splitflap/coordinator.py`** (*Optional*): Only if you need a brand new MQTT publish command or method that does not exist yet. If you are calling an existing method (like `send_text` or `fetch_esp32_data`), you do not need to touch coordinator.py!
- [ ] **`services.yaml`** (*Not needed*): Buttons are entities, not services.
- [ ] **`custom_components/splitflap/frontend/splitflap-card.js`** (*Optional*): The button automatically appears in Home Assistant's normal device page and can be added to standard dashboards. You only edit the card JS if you want a dedicated button inside the custom SplitFlap card.
- [ ] **`README.md`** (*Optional*): Add the button name to the list of provided entities.

---

## 4. Recipe: Add a New Function Service

A **Service** is an action that can be called from Home Assistant Automations, Scripts, and the Developer Tools page (e.g. `splitflap.send_text` or `splitflap.sync`).

### Files to edit:
1. `custom_components/splitflap/services.py` (Backend logic)
2. `custom_components/splitflap/services.yaml` (UI descriptions and fields)

---

### Step 1: Add the Service Handler
Open `custom_components/splitflap/services.py`. Find the `# SERVICE HANDLERS` section. Copy and paste this template:

#### Option A: Simple Service (No arguments)
```python
async def handle_CHANGE_ME(call: ServiceCall, hass: HomeAssistant) -> None:
    """CHANGE_ME: Short description of what this service does."""
    for coordinator in get_coordinators(hass):
        await coordinator.CHANGE_ME()
```

#### Option B: Service with Arguments / Inputs
If your service accepts data (for example, a string or a number):
```python
async def handle_CHANGE_ME(call: ServiceCall, hass: HomeAssistant) -> None:
    """CHANGE_ME: Short description of what this service does."""
    my_value = call.data["my_parameter"]
    for coordinator in get_coordinators(hass):
        await coordinator.CHANGE_ME(my_value)
```

---

### Step 2: Register the Service
In the same file (`custom_components/splitflap/services.py`), scroll down to the `SERVICES` list. Add an entry for your new service:

```python
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
        name="CHANGE_ME",          # Service name called as splitflap.CHANGE_ME
        handler=handle_CHANGE_ME,  # The function you created in Step 1
    ),
]
```

---

### Step 3: Add Documentation in `services.yaml`
Open `custom_components/splitflap/services.yaml`. Scroll to the bottom and add a description so Home Assistant's UI displays friendly names and help text:

```yaml
CHANGE_ME:
  name: CHANGE_ME
  description: Description of what this service does.
```

*(If your service accepts parameters, you can also define `fields:` here, exactly like `send_text` at the top of `services.yaml`.)*

### Checklist for Adding a Service:
- [x] **`custom_components/splitflap/services.py`** (*Required*): Write the handler function and add a `ServiceDefinition` to the `SERVICES` list.
- [x] **`custom_components/splitflap/services.yaml`** (*Required*): Add the name and description so it appears properly in Home Assistant Developer Tools and automations.
- [ ] **`custom_components/splitflap/coordinator.py`** (*Optional*): Only if your service needs a new coordinator method.
- [ ] **`README.md`** (*Optional*): Mention your new service in the documentation.
- [ ] **`custom_components/splitflap/frontend/splitflap-card.js`** (*Optional*): Only if you want to call this service from the custom Lovelace card.

---

## 5. How to Test Your Changes

### 1. Restart Home Assistant
Whenever you edit Python files or YAML files in a custom integration, Home Assistant must be restarted to load the new code:
1. In Home Assistant, click **Settings** in the left sidebar.
2. Click **System**.
3. In the top-right corner, click the **Restart** button (power icon).
4. Click **Restart Home Assistant**.

### 2. Check Logs for Any Typos
If anything was mistyped, Home Assistant will safely report it in the logs:
1. Go to **Settings** &rarr; **System** &rarr; **Logs**.
2. Type `splitflap` into the search box.
3. If there is a Python error (such as `SyntaxError` or `IndentationError`), the log will display the file name and the exact line number where the issue occurred.

### 3. How to Test Your New Button
1. Go to **Settings** &rarr; **Devices & Services** &rarr; **Devices**.
2. Click on your **SplitFlap** device.
3. Look for your new button under the **Controls** card.
4. Click **Press** and verify that your display responds.
*(You can also test buttons from **Developer Tools** &rarr; **States**, search for `button.splitflap_`, click on it, and click "Press".)*

### 4. How to Test Your New Service
1. In Home Assistant, click **Developer Tools** in the sidebar.
2. Click the **Services** (or **Actions**) tab at the top.
3. In the search box, type `splitflap.` and select your service.
4. Fill in any parameters (if applicable).
5. Click **Perform Action** (or **Call Service**).

---

## 6. Troubleshooting Common Errors

| Error in Logs | What it Means | How to Fix It |
|---|---|---|
| `IndentationError: unexpected indent` | A line has extra spaces at the start. | Align the line with the code directly above it (use 4 spaces per indent level). |
| `SyntaxError: invalid syntax` | Python encountered unexpected text. | Check for a missing comma `,`, an unclosed quote `"`, or a missing colon `:` at the end of a `def` or `class` line. |
| `NameError: name '...' is not defined` | Python does not recognize a name. | Check spelling in your class name, function name, or variable. |
| Button does not appear in Home Assistant | The button class was not registered. | Make sure you added your class to the `BUTTON_CLASSES` list at the bottom of `button.py` and restarted Home Assistant. |
| Service does not appear in Developer Tools | The service was not registered. | Make sure you added `ServiceDefinition(...)` to the `SERVICES` list in `services.py` and restarted Home Assistant. |
| `AttributeError: 'SplitFlapCoordinator' object has no attribute '...'` | The coordinator method called does not exist. | Check the method name called inside `async_press` or your service handler. Verify spelling against `coordinator.py`. |

---

## 7. Worked Example: Adding a "Clear Display" Button End-to-End

Let's walk through adding a button that blanks out all modules on the display.

### Step 1: Add the Button in `custom_components/splitflap/button.py`
Open `custom_components/splitflap/button.py`.

In the `# BUTTON DEFINITIONS` section, add:

```python
class SplitFlapClearButton(SplitFlapBaseButton):
    """Button to clear all SplitFlap display modules."""

    button_id = "clear"
    _attr_name = "Clear Display"
    _attr_icon = "mdi:eraser"

    async def async_press(self) -> None:
        """Clear all characters on the display."""
        await self.coordinator.send_text("")
```

### Step 2: Add to `BUTTON_CLASSES`
In `custom_components/splitflap/button.py`, find `BUTTON_CLASSES` at the bottom and add `SplitFlapClearButton`:

```python
BUTTON_CLASSES: list[type[SplitFlapBaseButton]] = [
    SplitFlapSyncButton,
    SplitFlapScanButton,
    SplitFlapClearButton,
]
```

### Step 3: Save and Restart Home Assistant
1. Save `button.py`.
2. In Home Assistant: **Settings** &rarr; **System** &rarr; **Restart**.

### Step 4: Verify in Home Assistant
1. Go to **Settings** &rarr; **Devices & Services** &rarr; **SplitFlap**.
2. Under **Controls**, you will now see **Clear Display** with an eraser icon!
3. Click **Press**: all modules on your SplitFlap display will be set to blank flaps.
