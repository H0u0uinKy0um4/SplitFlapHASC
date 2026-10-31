/**
 * SplitFlap Card for Home Assistant
 * Interactive Lovelace card displaying split-flap tiles and control buttons.
 *
 * Each hardware module is rendered as its own tile. Clicking a tile opens an
 * in-card module panel with its stats. If the integration exposes a per-module
 * sensor entity, the panel can also open the normal Home Assistant more-info
 * dialog, but the card works without per-module entities.
 */

const SPLITFLAP_CARD_VERSION = "1.3.0";
const MODULE_ID_ATTR = "splitflap_module_id";
const MODULE_PREFIX_ATTR = "splitflap_prefix";
const LAYOUT_STORAGE_PREFIX = "splitflap-card-layout:";

const ENTITY_PATTERNS = {
  text: [
    /^text\..*splitflap.*display_text$/i,
    /^text\..*display_text$/i,
    /^text\..*splitflap.*text$/i,
  ],
  status: [
    /^sensor\..*splitflap.*master_status$/i,
    /^sensor\..*master_status$/i,
  ],
  modules: [
    /^sensor\..*splitflap.*detected_modules$/i,
    /^sensor\..*detected_modules$/i,
  ],
  sync: [
    /^button\..*splitflap.*sync$/i,
    /^button\..*_sync$/i,
  ],
  scan: [
    /^button\..*splitflap.*scan$/i,
    /^button\..*_scan$/i,
  ],
};

// The same aliases the integration accepts, so the card can show module stats
// from the aggregate Detected Modules sensor even when no per-module entity
// exists.
const MODULE_STAT_ALIASES = {
  flap_list: [
    "flap_list",
    "flapList",
    "FlapList",
    "flaps",
    "drum",
    "drum_chars",
    "drumChars",
    "characters",
  ],
  current_step: [
    "current_step",
    "currentStep",
    "CurrentStep",
    "current_step_pos",
    "currentStepPos",
    "step",
    "step_position",
    "position_step",
  ],
  current_index: [
    "current_index",
    "currentIndex",
    "CurrentIndex",
    "current_flap_index",
    "currentFlapIndex",
    "flap_index",
    "flapIndex",
    "index",
  ],
  auto_homing: [
    "auto_homing",
    "autoHoming",
    "AutoHoming",
    "auto_home",
    "autoHome",
    "autoHomeEnabled",
    "autohome",
  ],
  online: ["online", "is_online", "isOnline", "connected"],
  home_offset: [
    "home_offset",
    "homeOffset",
    "HomeOffset",
    "hall_offset",
    "hallOffset",
  ],
  total_steps: [
    "total_steps",
    "totalSteps",
    "TotalSteps",
    "total_steps_per_rev",
    "totalStepsPerRev",
    "steps_per_rev",
    "stepsPerRev",
    "max_steps",
    "maxSteps",
  ],
  last_seen: ["last_seen", "lastSeen", "last_seen_ms", "lastSeenMs"],
  map_of_positions: [
    "map_of_positions",
    "mapOfPositions",
    "MapOfPositions",
    "position_map",
    "positionMap",
    "positions",
    "map",
  ],
};

const MODULE_BASE_KEYS = new Set([
  "id",
  "flap",
  "state",
  "status",
  "module_state",
  "module_id",
  "position",
  "topic_prefix",
  "splitflap_module_id",
  "splitflap_prefix",
  "extra_stats",
  "flap_position",
  "friendly_name",
  "icon",
  "device_class",
  "unit_of_measurement",
  "state_class",
  "supported_features",
  "entity_id",
]);

const MODULE_KNOWN_KEYS = new Set([
  ...MODULE_BASE_KEYS,
  ...Object.values(MODULE_STAT_ALIASES).flat(),
]);

const DEFAULT_CONFIG = {
  title: "SplitFlap Display",
  text_entity: "text.splitflap_display_text",
  status_entity: "sensor.splitflap_master_status",
  modules_sensor: "sensor.splitflap_detected_modules",
  sync_entity: "button.splitflap_sync",
  scan_entity: "button.splitflap_scan",
  module_entities: [],
  // Layout defaults. `module_columns: 0` means auto-fit to the card width.
  module_columns: 0,
  // Tile aspect ratio as "width:height" (38:52) or a number (0.73).
  module_ratio: "",
  module_gap: "",
};

function compareModuleIds(a, b) {
  const aText = String(a ?? "");
  const bText = String(b ?? "");
  const aNumber = /^\d+$/.test(aText) ? Number(aText) : null;
  const bNumber = /^\d+$/.test(bText) ? Number(bText) : null;

  if (aNumber !== null && bNumber !== null) return aNumber - bNumber;
  if (aNumber !== null) return -1;
  if (bNumber !== null) return 1;
  return aText.localeCompare(bText, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function isOnlineState(state) {
  return /^(online|on|connected|ready)$/i.test(String(state ?? ""));
}

function firstCodePoint(value) {
  const text = String(value ?? "");
  if (!text) return "";
  return Array.from(text)[0];
}

class SplitFlapCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._hass = undefined;
    this._config = undefined;
    this._optimisticText = undefined;
    this._optimisticTimer = undefined;
    this._feedbackTimer = undefined;
    this._moduleSignature = "";
    this._fallbackSignature = "";
    this._skeletonBuilt = false;
    this._selectedModuleId = undefined;
    this._selectedModule = undefined;
    this._selectedEntityId = undefined;
    this._detailsSignature = "";
    this._layoutDefaults = { columns: 0, ratio: undefined, gap: undefined };
    this._layout = { ...this._layoutDefaults };
    this._layoutSignature = "";
    this._settingsOpen = false;
    this._modulesCount = 0;
    this._refs = {};

    // Attached once: the shadow root survives skeleton rebuilds, so adding this
    // in _buildSkeleton would stack duplicate listeners after config changes.
    this.shadowRoot.addEventListener("keydown", (event) => {
      const panel = this._refs.moduleDetails;
      if (event.key === "Escape" && panel && !panel.hidden) {
        this._closeModuleDetails();
      }
    });
  }

  static getStubConfig(hass) {
    const states = hass && hass.states ? hass.states : {};
    const findEntity = (patterns) => {
      for (const pattern of patterns) {
        const match = Object.keys(states).find((entityId) =>
          pattern.test(entityId)
        );
        if (match) return match;
      }
      return undefined;
    };

    const config = { title: "SplitFlap Display" };
    const values = {
      text_entity: findEntity(ENTITY_PATTERNS.text),
      status_entity: findEntity(ENTITY_PATTERNS.status),
      modules_sensor: findEntity(ENTITY_PATTERNS.modules),
      sync_entity: findEntity(ENTITY_PATTERNS.sync),
      scan_entity: findEntity(ENTITY_PATTERNS.scan),
    };

    for (const [key, value] of Object.entries(values)) {
      if (value) config[key] = value;
    }
    return config;
  }

  setConfig(config) {
    if (config !== undefined && (config === null || typeof config !== "object")) {
      throw new Error("SplitFlap card configuration must be an object.");
    }

    const supplied = config || {};
    this._config = { ...DEFAULT_CONFIG, ...supplied };
    if (supplied.entity && !supplied.text_entity) {
      this._config.text_entity = supplied.entity;
    }
    if (!Array.isArray(this._config.module_entities)) {
      this._config.module_entities =
        typeof this._config.module_entities === "string" &&
        this._config.module_entities
          ? [this._config.module_entities]
          : [];
    }

    this._layoutDefaults = {
      columns: this._parseColumns(
        supplied.module_columns ?? supplied.columns ?? DEFAULT_CONFIG.module_columns
      ),
      ratio: this._parseRatio(
        supplied.module_ratio ?? supplied.ratio ?? DEFAULT_CONFIG.module_ratio
      ),
      gap: this._parseGap(
        supplied.module_gap ?? supplied.gap ?? DEFAULT_CONFIG.module_gap
      ),
    };
    this._layout = { ...this._layoutDefaults, ...this._loadSavedLayout() };
    this._layoutSignature = "";

    this._optimisticText = undefined;
    this._clearOptimisticTimer();
    this._moduleSignature = "";
    this._fallbackSignature = "";
    this._skeletonBuilt = false;
    this._selectedModuleId = undefined;
    this._selectedModule = undefined;
    this._selectedEntityId = undefined;
    this._detailsSignature = "";

    if (this._hass) this.render();
  }

  set hass(hass) {
    this._hass = hass;
    this.render();
  }

  getCardSize() {
    return 4;
  }

  _parseColumns(value) {
    const columns = Number.parseInt(value, 10);
    return Number.isFinite(columns) && columns > 0 ? columns : 0;
  }

  _parseRatio(value) {
    if (value === undefined || value === null || value === "") return undefined;
    if (typeof value === "number") {
      return Number.isFinite(value) && value > 0 ? value : undefined;
    }

    const text = String(value).trim().replace(",", ".");
    if (!text) return undefined;

    const pair = text.match(/^(\d+(?:\.\d+)?)\s*[:/x×]\s*(\d+(?:\.\d+)?)$/i);
    if (pair) {
      const width = Number.parseFloat(pair[1]);
      const height = Number.parseFloat(pair[2]);
      if (width > 0 && height > 0) return width / height;
      return undefined;
    }

    const ratio = Number.parseFloat(text);
    return Number.isFinite(ratio) && ratio > 0 ? ratio : undefined;
  }

  _parseGap(value) {
    if (value === undefined || value === null || value === "") return undefined;
    const gap = Number.parseFloat(String(value).replace(/px$/i, "").trim());
    return Number.isFinite(gap) && gap >= 0 ? gap : undefined;
  }

  _layoutStorageKey() {
    const identity =
      this._config.text_entity ||
      this._config.status_entity ||
      this._config.title ||
      "default";
    return `${LAYOUT_STORAGE_PREFIX}${identity}`;
  }

  _loadSavedLayout() {
    try {
      const raw = window.localStorage.getItem(this._layoutStorageKey());
      if (!raw) return {};
      const saved = JSON.parse(raw);
      if (!saved || typeof saved !== "object") return {};
      const layout = {};
      if (saved.columns !== undefined) {
        layout.columns = this._parseColumns(saved.columns);
      }
      if (saved.ratio !== undefined) {
        layout.ratio = this._parseRatio(saved.ratio);
      }
      if (saved.gap !== undefined) {
        layout.gap = this._parseGap(saved.gap);
      }
      return layout;
    } catch (err) {
      console.debug("[splitflap-card] Could not read saved layout:", err);
      return {};
    }
  }

  _saveLayout() {
    try {
      window.localStorage.setItem(
        this._layoutStorageKey(),
        JSON.stringify(this._layout)
      );
    } catch (err) {
      console.debug("[splitflap-card] Could not save layout:", err);
    }
  }

  _resetLayout() {
    try {
      window.localStorage.removeItem(this._layoutStorageKey());
    } catch (err) {
      console.debug("[splitflap-card] Could not clear saved layout:", err);
    }
    this._layout = { ...this._layoutDefaults };
    this._layoutSignature = "";
    this._applyLayout();
    this._updateLayoutInputs();
  }

  _updateLayoutInputs() {
    if (this._refs.columnsInput) {
      this._refs.columnsInput.value = this._layout.columns
        ? String(this._layout.columns)
        : "";
    }
    if (this._refs.ratioInput) {
      this._refs.ratioInput.value =
        this._layout.ratio !== undefined
          ? String(Math.round(this._layout.ratio * 10000) / 10000)
          : "";
    }
    if (this._refs.gapInput) {
      this._refs.gapInput.value =
        this._layout.gap !== undefined ? String(this._layout.gap) : "";
    }
  }

  _applyLayout() {
    const row = this._refs.flapTiles;
    if (!row) return;

    const { columns, ratio, gap } = this._layout;
    const moduleCount = Math.max(Number(this._modulesCount) || 0, 0);
    // Treat the configured columns as a maximum per row. Without this, setting
    // e.g. 50 columns on a 30-module board creates 20 empty tracks and squeezes
    // every tile into a third of the available width.
    const activeColumns =
      columns > 0 ? Math.min(columns, moduleCount > 0 ? moduleCount : columns) : 0;
    const signature = `${activeColumns}|${ratio ?? ""}|${gap ?? ""}`;
    if (signature === this._layoutSignature) return;

    row.classList.toggle("fixed-columns", activeColumns > 0);
    if (activeColumns > 0) {
      row.style.gridTemplateColumns = `repeat(${activeColumns}, minmax(0, 1fr))`;
    } else {
      row.style.removeProperty("grid-template-columns");
    }

    if (ratio !== undefined) {
      row.style.setProperty("--tile-aspect", String(ratio));
    } else {
      row.style.removeProperty("--tile-aspect");
    }

    if (gap !== undefined) {
      row.style.setProperty("--tile-gap", `${gap}px`);
    } else {
      row.style.removeProperty("--tile-gap");
    }

    this._layoutSignature = signature;
  }

  disconnectedCallback() {
    this._clearOptimisticTimer();
    if (this._feedbackTimer !== undefined) {
      window.clearTimeout(this._feedbackTimer);
      this._feedbackTimer = undefined;
    }
  }

  _resolveEntityId(primary, patterns) {
    const states = this._hass && this._hass.states ? this._hass.states : {};

    if (primary && Object.prototype.hasOwnProperty.call(states, primary)) {
      return primary;
    }

    for (const pattern of patterns || []) {
      const match = Object.keys(states).find((entityId) => pattern.test(entityId));
      if (match) return match;
    }

    return primary || undefined;
  }

  _clearOptimisticTimer() {
    if (this._optimisticTimer !== undefined) {
      window.clearTimeout(this._optimisticTimer);
      this._optimisticTimer = undefined;
    }
  }

  _showFeedback(message, isError = false) {
    if (!this._refs.feedback) return;
    this._refs.feedback.textContent = message || "";
    this._refs.feedback.classList.toggle("error", Boolean(isError));

    if (this._feedbackTimer !== undefined) {
      window.clearTimeout(this._feedbackTimer);
    }
    if (message) {
      this._feedbackTimer = window.setTimeout(() => {
        if (this._refs.feedback) {
          this._refs.feedback.textContent = "";
          this._refs.feedback.classList.remove("error");
        }
        this._feedbackTimer = undefined;
      }, 4000);
    }
  }

  _sendText() {
    const input = this._refs.input;
    if (!input || !this._hass) return;

    const value = input.value;
    const start = this._getStartPosition();
    const moduleCount = Number(this._modulesCount) || 0;
    const maxStart = moduleCount > 0 ? moduleCount : 1000;

    if (start > maxStart) {
      this._showFeedback(`Start must be between 1 and ${maxStart}`, true);
      input.focus();
      return;
    }

    const fullText = this._composeText(value, start);

    this._optimisticText = fullText;
    this._clearOptimisticTimer();
    this._optimisticTimer = window.setTimeout(() => {
      this._optimisticText = undefined;
      this._optimisticTimer = undefined;
      this.render();
    }, 15000);

    this.render();

    const textEntity = this._resolveEntityId(
      this._config.text_entity,
      ENTITY_PATTERNS.text
    );

    try {
      const request =
        textEntity && this._hass.states[textEntity]
          ? this._hass.callService("text", "set_value", {
              entity_id: textEntity,
              value: fullText,
            })
          : this._hass.callService("splitflap", "send_text", {
              text: fullText,
            });

      Promise.resolve(request)
        .then(() => {
          if (value) {
            this._showFeedback(
              start > 1 ? `Text sent from module ${start}` : "Text sent"
            );
          } else {
            this._showFeedback(
              start > 1
                ? `Display cleared from module ${start}`
                : "Display cleared"
            );
          }
        })
        .catch((err) => {
          console.error("[splitflap-card] Failed to send text:", err);
          this._optimisticText = undefined;
          this._clearOptimisticTimer();
          this.render();
          this._showFeedback("Could not send text", true);
        });
    } catch (err) {
      console.error("[splitflap-card] Failed to send text:", err);
      this._optimisticText = undefined;
      this._clearOptimisticTimer();
      this.render();
      this._showFeedback("Could not send text", true);
    }

    input.value = "";
    input.focus();
  }

  _getStartPosition() {
    const input = this._refs.startInput;
    const start = Number.parseInt(input ? input.value : "1", 10);
    return Number.isFinite(start) && start > 0 ? start : 1;
  }

  _composeText(text, start = 1) {
    const offset = Math.max((Number(start) || 1) - 1, 0);
    return offset > 0 ? `${" ".repeat(offset)}${text}` : String(text);
  }

  _pressButton(primary, patterns, serviceName) {
    if (!this._hass) return;

    const entityId = this._resolveEntityId(primary, patterns);

    try {
      let request;
      if (entityId && this._hass.states[entityId]) {
        request = this._hass.callService("button", "press", {
          entity_id: entityId,
        });
      } else if (serviceName) {
        request = this._hass.callService("splitflap", serviceName, {});
      } else {
        this._showFeedback("Button entity is not available", true);
        return;
      }

      Promise.resolve(request)
        .then(() => this._showFeedback("Command sent"))
        .catch((err) => {
          console.error(`[splitflap-card] Failed to run ${serviceName}:`, err);
          this._showFeedback("Command failed", true);
        });
    } catch (err) {
      console.error(`[splitflap-card] Failed to run ${serviceName}:`, err);
      this._showFeedback("Command failed", true);
    }
  }

  _collectModuleEntities(prefix) {
    if (!this._hass || !this._hass.states) return [];

    let entityIds = (this._config.module_entities || []).filter((entityId) => {
      const stateObj = entityId ? this._hass.states[entityId] : undefined;
      return stateObj && stateObj.state !== "unavailable";
    });

    if (entityIds.length === 0) {
      entityIds = Object.keys(this._hass.states).filter((entityId) => {
        const stateObj = this._hass.states[entityId];
        if (stateObj.state === "unavailable") return false;
        const attrs = stateObj.attributes || {};
        if (attrs[MODULE_ID_ATTR] === undefined || attrs[MODULE_ID_ATTR] === null) {
          return false;
        }
        if (
          prefix &&
          attrs[MODULE_PREFIX_ATTR] !== undefined &&
          attrs[MODULE_PREFIX_ATTR] !== prefix
        ) {
          return false;
        }
        return true;
      });
    }

    const modules = [];
    const seen = new Set();
    for (const entityId of entityIds) {
      const stateObj = this._hass.states[entityId];
      if (!stateObj) continue;

      const attrs = stateObj.attributes || {};
      const moduleId = String(
        attrs[MODULE_ID_ATTR] ?? attrs.module_id ?? entityId
      );
      if (seen.has(moduleId)) continue;
      seen.add(moduleId);

      const flap =
        attrs.flap !== undefined && attrs.flap !== null
          ? attrs.flap
          : stateObj.state;

      modules.push({
        id: moduleId,
        entityId,
        raw: attrs,
        flap: flap === undefined || flap === null ? "" : String(flap),
        hasFlap: attrs.flap !== undefined && attrs.flap !== null,
        state: String(attrs.module_state ?? stateObj.state ?? "unknown"),
        position: attrs.position,
        currentStep:
          attrs.current_step ?? attrs.currentStep ?? attrs.currentStepPos,
        autoHoming: attrs.auto_homing ?? attrs.autoHoming ?? attrs.autoHome,
        flapCount: Array.isArray(attrs.flap_list)
          ? attrs.flap_list.length
          : undefined,
        mapCount:
          attrs.map_of_positions && typeof attrs.map_of_positions === "object"
            ? Object.keys(attrs.map_of_positions).length
            : undefined,
      });
    }

    return modules.sort((a, b) => compareModuleIds(a.id, b.id));
  }

  _collectModules(modulesState, statusState) {
    const prefix =
      (modulesState && modulesState.attributes
        ? modulesState.attributes.topic_prefix
        : undefined) ??
      (statusState && statusState.attributes
        ? statusState.attributes.topic_prefix
        : undefined);

    const modulesById = new Map();

    // Backwards-compatible source: the module map on the Detected Modules
    // sensor. It is also useful as a fallback while per-module entities are
    // still being created by the integration.
    const rawModules =
      modulesState && modulesState.attributes
        ? modulesState.attributes.modules
        : undefined;

    if (Array.isArray(rawModules)) {
      for (const item of rawModules) {
        if (!item || typeof item !== "object" || item.id === undefined) continue;
        const id = String(item.id);
        modulesById.set(id, {
          id,
          entityId: "",
          raw: item,
          flap: item.flap === undefined || item.flap === null ? "" : String(item.flap),
          hasFlap: item.flap !== undefined && item.flap !== null,
          state: String(item.state ?? "unknown"),
          position: undefined,
        });
      }
    } else if (rawModules && typeof rawModules === "object") {
      for (const [moduleId, item] of Object.entries(rawModules)) {
        const module = item && typeof item === "object" ? item : {};
        const id = String(module.id ?? moduleId);
        modulesById.set(id, {
          id,
          entityId: "",
          raw: module,
          flap:
            module.flap === undefined || module.flap === null
              ? ""
              : String(module.flap),
          hasFlap: module.flap !== undefined && module.flap !== null,
          state: String(module.state ?? "unknown"),
          position: undefined,
        });
      }
    }

    // Prefer per-module entities, but keep any modules only present in the
    // aggregate sensor payload.
    for (const module of this._collectModuleEntities(prefix)) {
      const existing = modulesById.get(module.id);
      modulesById.set(module.id, {
        ...existing,
        ...module,
        position: module.position ?? (existing ? existing.position : undefined),
      });
    }

    return Array.from(modulesById.values())
      .sort((a, b) => compareModuleIds(a.id, b.id))
      .map((module, index) => ({ ...module, displayPosition: index + 1 }));
  }

  render() {
    if (!this._hass || !this._config) return;

    const textEntityId = this._resolveEntityId(
      this._config.text_entity,
      ENTITY_PATTERNS.text
    );
    const statusEntityId = this._resolveEntityId(
      this._config.status_entity,
      ENTITY_PATTERNS.status
    );
    const modulesEntityId = this._resolveEntityId(
      this._config.modules_sensor,
      ENTITY_PATTERNS.modules
    );

    const textState = textEntityId ? this._hass.states[textEntityId] : undefined;
    const statusState = statusEntityId
      ? this._hass.states[statusEntityId]
      : undefined;
    const modulesState = modulesEntityId
      ? this._hass.states[modulesEntityId]
      : undefined;

    let currentText =
      this._optimisticText !== undefined
        ? this._optimisticText
        : textState
          ? textState.state
          : "";

    const showOptimistic = this._optimisticText !== undefined;

    if (
      this._optimisticText !== undefined &&
      textState &&
      textState.state === this._optimisticText
    ) {
      this._optimisticText = undefined;
      this._clearOptimisticTimer();
    }

    if (
      currentText === "unknown" ||
      currentText === "unavailable" ||
      currentText === undefined ||
      currentText === null
    ) {
      currentText = "";
    }

    const masterStatus = statusState ? statusState.state : "offline";
    const modules = this._collectModules(modulesState, statusState);

    let reportedCount = 0;
    if (modulesState) {
      const parsed = Number.parseInt(modulesState.state, 10);
      if (Number.isFinite(parsed)) reportedCount = Math.max(parsed, 0);
    }
    const modulesCount = modules.length > 0 ? modules.length : reportedCount;
    this._modulesCount = modulesCount;

    if (!this._skeletonBuilt) {
      this._buildSkeleton();
    }

    this._applyLayout();
    this._updateStartBounds(modulesCount);
    this._updateHeader(masterStatus, modulesCount);
    this._updateFlaps(currentText, modules, modulesCount, showOptimistic);
    this._updateOverflowHint(currentText, modules, modulesCount);
    this._updateModuleDetails(modules);
  }

  _updateStartBounds(modulesCount) {
    const input = this._refs.startInput;
    if (!input) return;
    if (modulesCount > 0) {
      input.max = String(modulesCount);
    } else {
      input.removeAttribute("max");
    }
  }

  _buildSkeleton() {
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
        }
        ha-card {
          padding: 18px;
          background: var(--ha-card-background, var(--card-background-color, #1e1e24));
          color: var(--primary-text-color, #ffffff);
          border-radius: var(--ha-card-border-radius, 12px);
          box-shadow: var(--ha-card-box-shadow, 0 4px 12px rgba(0, 0, 0, 0.15));
          font-family: var(--paper-font-body1_-_font-family, system-ui, sans-serif);
          overflow: hidden;
        }
        .header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 16px;
        }
        .title {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-size: 1.15rem;
          font-weight: 600;
          letter-spacing: 0.5px;
        }
        .badge {
          flex: 0 0 auto;
          padding: 3px 8px;
          border-radius: 999px;
          font-size: 0.72rem;
          font-weight: 700;
          letter-spacing: 0.5px;
          text-transform: uppercase;
        }
        .badge-online {
          background: rgba(46, 204, 113, 0.2);
          color: #2ecc71;
          border: 1px solid rgba(46, 204, 113, 0.4);
        }
        .badge-offline {
          background: rgba(231, 76, 60, 0.2);
          color: #e74c3c;
          border: 1px solid rgba(231, 76, 60, 0.4);
        }
        .header-tools {
          display: flex;
          flex: 0 0 auto;
          align-items: center;
          gap: 8px;
        }
        .settings-toggle {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 30px;
          height: 30px;
          padding: 0;
          border: 1px solid var(--divider-color, #383842);
          border-radius: 50%;
          background: transparent;
          color: var(--secondary-text-color, #8e8e93);
          cursor: pointer;
          font-size: 0.95rem;
          line-height: 1;
        }
        .settings-toggle:hover,
        .settings-toggle.active {
          border-color: var(--primary-color, #03a9f4);
          color: var(--primary-color, #03a9f4);
        }
        .layout-settings {
          margin-bottom: 16px;
          padding: 12px;
          background: var(--secondary-background-color, #26262e);
          border: 1px solid var(--divider-color, #383842);
          border-radius: 8px;
        }
        .layout-settings[hidden] {
          display: none;
        }
        .layout-settings-row {
          display: flex;
          flex-wrap: wrap;
          align-items: flex-end;
          gap: 10px;
        }
        .layout-field {
          display: flex;
          flex-direction: column;
          gap: 4px;
          color: var(--secondary-text-color, #8e8e93);
          font-size: 0.68rem;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }
        .layout-input {
          width: 110px;
          box-sizing: border-box;
          padding: 8px 10px;
          border: 1px solid var(--divider-color, #383842);
          border-radius: 6px;
          outline: none;
          background: var(--card-background-color, #26262e);
          color: var(--primary-text-color, #fff);
          font-size: 0.85rem;
          letter-spacing: normal;
          text-transform: none;
        }
        .layout-input:focus {
          border-color: var(--primary-color, #03a9f4);
        }
        .layout-hint {
          margin-top: 8px;
          color: var(--secondary-text-color, #8e8e93);
          font-size: 0.7rem;
          line-height: 1.35;
        }
        .board-container {
          padding: clamp(10px, 3vw, 16px);
          margin-bottom: 16px;
          background: #111114;
          border: 1px solid #2d2d35;
          border-radius: 8px;
          box-shadow: inset 0 2px 6px rgba(0, 0, 0, 0.4);
        }
        .board-header {
          display: flex;
          justify-content: space-between;
          gap: 8px;
          margin-bottom: 8px;
          color: var(--secondary-text-color, #8e8e93);
          font-size: 0.75rem;
          text-transform: uppercase;
        }
        .flap-row {
          --tile-aspect: 38 / 52;
          --tile-gap: clamp(3px, 1.2vw, 6px);
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(28px, 52px));
          justify-content: center;
          align-items: center;
          gap: var(--tile-gap);
          min-height: 52px;
        }
        .flap-row.fixed-columns {
          justify-content: stretch;
        }
        .flap-tile {
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 100%;
          aspect-ratio: var(--tile-aspect, 38 / 52);
          overflow: hidden;
          background: #222228;
          border: 1px solid #33333d;
          border-radius: 5px;
          box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
          color: #f5f5f7;
          container-type: inline-size;
          user-select: none;
        }
        .flap-tile.clickable {
          cursor: pointer;
        }
        .flap-tile.clickable:hover {
          border-color: var(--primary-color, #03a9f4);
        }
        .flap-tile.clickable:focus-visible {
          outline: 2px solid var(--primary-color, #03a9f4);
          outline-offset: 2px;
        }
        .flap-tile::after {
          content: '';
          position: absolute;
          left: 0;
          right: 0;
          top: 50%;
          height: 1.5px;
          background: rgba(0, 0, 0, 0.75);
          box-shadow: 0 1px 0 rgba(255, 255, 255, 0.08);
          pointer-events: none;
        }
        .flap-char {
          margin-top: -8%;
          font-family: 'SF Mono', Monaco, 'Courier New', monospace;
          font-size: 1.4rem;
          font-size: clamp(0.85rem, 46cqw, 1.8rem);
          font-weight: 700;
          line-height: 1;
        }
        .module-sublabel {
          position: absolute;
          right: 0;
          bottom: 2px;
          bottom: max(1px, 3cqw);
          left: 0;
          padding: 0 2px;
          box-sizing: border-box;
          overflow: hidden;
          color: #8a8a94;
          font-family: var(--paper-font-body1_-_font-family, system-ui, sans-serif);
          font-size: 0.55rem;
          font-size: clamp(0.38rem, 15cqw, 0.6rem);
          font-weight: 500;
          letter-spacing: -0.02em;
          line-height: 1;
          text-align: center;
          text-overflow: clip;
          white-space: nowrap;
        }
        .flap-tile.placeholder {
          opacity: 0.55;
        }
        .board-footer {
          display: none;
          margin-top: 8px;
          color: var(--warning-color, #f39c12);
          font-size: 0.7rem;
          line-height: 1.3;
        }
        .board-footer.visible {
          display: block;
        }
        .flap-tile.selected {
          border-color: var(--primary-color, #03a9f4);
          box-shadow: 0 0 0 2px var(--primary-color, #03a9f4);
        }
        .module-details-backdrop {
          position: fixed;
          inset: 0;
          z-index: 19;
          background: rgba(0, 0, 0, 0.45);
        }
        .module-details-backdrop[hidden] {
          display: none;
        }
        .module-details {
          position: fixed;
          bottom: max(16px, env(safe-area-inset-bottom, 0px));
          left: 50%;
          z-index: 20;
          box-sizing: border-box;
          width: min(560px, calc(100vw - 24px));
          max-height: min(72vh, 680px);
          margin: 0;
          padding: 14px;
          overflow: auto;
          transform: translateX(-50%);
          background: var(--card-background-color, #1e1e24);
          border: 1px solid var(--divider-color, #383842);
          border-radius: 12px;
          box-shadow: 0 16px 48px rgba(0, 0, 0, 0.55);
        }
        .module-details[hidden] {
          display: none;
        }
        .module-details-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          margin-bottom: 10px;
        }
        .module-details-title {
          font-size: 0.95rem;
          font-weight: 600;
        }
        .module-details-close {
          width: 28px;
          height: 28px;
          padding: 0;
          border: none;
          border-radius: 50%;
          background: transparent;
          color: var(--secondary-text-color, #8e8e93);
          cursor: pointer;
          font-size: 1.2rem;
          line-height: 1;
        }
        .module-details-close:hover {
          background: var(--divider-color, #383842);
          color: var(--primary-text-color, #fff);
        }
        .module-details-body {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
          gap: 8px 14px;
        }
        .detail-item {
          display: flex;
          flex-direction: column;
          gap: 2px;
          min-width: 0;
        }
        .detail-item.wide {
          grid-column: 1 / -1;
        }
        .detail-label {
          color: var(--secondary-text-color, #8e8e93);
          font-size: 0.68rem;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }
        .detail-value {
          color: var(--primary-text-color, #fff);
          font-size: 0.85rem;
          overflow-wrap: anywhere;
        }
        .detail-value.mono {
          font-family: 'SF Mono', Monaco, 'Courier New', monospace;
          font-size: 0.75rem;
          white-space: pre-wrap;
        }
        .detail-map {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(68px, 1fr));
          gap: 4px;
          max-height: 150px;
          overflow: auto;
        }
        .detail-map-entry {
          padding: 3px 6px;
          border-radius: 4px;
          background: var(--card-background-color, #1e1e24);
          font-family: 'SF Mono', Monaco, 'Courier New', monospace;
          font-size: 0.7rem;
          text-align: center;
        }
        .module-details-actions {
          display: flex;
          flex-wrap: wrap;
          justify-content: flex-end;
          gap: 8px;
          margin-top: 10px;
        }
        .module-details-actions .btn-secondary {
          flex: 0 0 auto;
        }
        .controls {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-bottom: 8px;
        }
        .start-field {
          display: flex;
          flex: 0 0 auto;
          align-items: center;
          gap: 6px;
          box-sizing: border-box;
          padding: 0 10px;
          border: 1px solid var(--divider-color, #383842);
          border-radius: 6px;
          background: var(--card-background-color, #26262e);
          transition: border-color 0.2s;
        }
        .start-field:focus-within {
          border-color: var(--primary-color, #03a9f4);
        }
        .start-label {
          color: var(--secondary-text-color, #8e8e93);
          font-size: 0.66rem;
          font-weight: 600;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }
        .start-input {
          width: 48px;
          padding: 10px 0;
          border: none;
          outline: none;
          background: transparent;
          color: var(--primary-text-color, #fff);
          font-size: 0.95rem;
          text-align: center;
          -moz-appearance: textfield;
        }
        .start-input::-webkit-outer-spin-button,
        .start-input::-webkit-inner-spin-button {
          margin: 0;
          -webkit-appearance: none;
        }
        .text-input {
          flex: 1 1 180px;
          min-width: 0;
          padding: 10px 14px;
          border: 1px solid var(--divider-color, #383842);
          border-radius: 6px;
          outline: none;
          background: var(--card-background-color, #26262e);
          color: var(--primary-text-color, #fff);
          font-size: 0.95rem;
          transition: border-color 0.2s;
        }
        .text-input:focus {
          border-color: var(--primary-color, #03a9f4);
        }
        .btn {
          cursor: pointer;
          border: none;
          border-radius: 6px;
          padding: 10px 16px;
          font-size: 0.9rem;
          font-weight: 600;
          transition: opacity 0.2s, background-color 0.2s;
        }
        .btn:hover {
          opacity: 0.88;
        }
        .btn-primary {
          flex: 0 0 auto;
          background: var(--primary-color, #03a9f4);
          color: var(--text-primary-color, #ffffff);
        }
        .btn-secondary {
          flex: 1 1 130px;
          padding: 8px 12px;
          border: 1px solid var(--divider-color, #3a3a46);
          background: var(--secondary-background-color, #2b2b34);
          color: var(--primary-text-color, #ececec);
          font-size: 0.82rem;
        }
        .feedback {
          min-height: 1.1em;
          margin: 0 0 8px;
          color: var(--secondary-text-color, #8e8e93);
          font-size: 0.75rem;
        }
        .feedback.error {
          color: var(--error-color, #e74c3c);
        }
        .actions-row {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          padding-top: 12px;
          border-top: 1px solid var(--divider-color, rgba(255, 255, 255, 0.08));
        }
      </style>

      <ha-card>
        <div class="header">
          <div class="title" id="cardTitle"></div>
          <div class="header-tools">
            <span id="statusBadge" class="badge badge-offline"></span>
            <button
              class="settings-toggle"
              id="settingsToggle"
              type="button"
              aria-label="Layout settings"
              aria-expanded="false"
              title="Layout settings"
            >
              &#9881;
            </button>
          </div>
        </div>

        <div class="layout-settings" id="layoutSettings" hidden>
          <div class="layout-settings-row">
            <label class="layout-field">
              Columns
              <input
                id="columnsInput"
                class="layout-input"
                type="number"
                min="0"
                step="1"
                placeholder="Auto"
              />
            </label>
            <label class="layout-field">
              Tile ratio
              <input
                id="ratioInput"
                class="layout-input"
                type="text"
                placeholder="38:52"
              />
            </label>
            <label class="layout-field">
              Gap (px)
              <input
                id="gapInput"
                class="layout-input"
                type="number"
                min="0"
                step="1"
                placeholder="Auto"
              />
            </label>
            <button id="layoutResetBtn" class="btn btn-secondary" type="button">
              Reset
            </button>
          </div>
          <div class="layout-hint">
            Columns: 0 or empty = auto-fit. Tile ratio accepts "38:52" or a
            number like 0.73. Layout settings are saved in this browser.
          </div>
        </div>

        <div class="board-container">
          <div class="board-header">
            <span>Display Preview</span>
            <span id="modulesCountSpan"></span>
          </div>
          <div class="flap-row" id="flapTiles"></div>
          <div class="board-footer" id="boardFooter"></div>
        </div>

        <div class="module-details-backdrop" id="moduleDetailsBackdrop" hidden></div>
        <div class="module-details" id="moduleDetails" hidden>
          <div class="module-details-header">
            <span class="module-details-title" id="moduleDetailsTitle"></span>
            <button
              class="module-details-close"
              id="moduleDetailsClose"
              type="button"
              aria-label="Close module details"
            >
              &times;
            </button>
          </div>
          <div class="module-details-body" id="moduleDetailsBody"></div>
          <div class="module-details-actions">
            <button
              class="btn btn-secondary"
              id="moduleDetailsStart"
              type="button"
            >
              Use as start
            </button>
            <button class="btn btn-secondary" id="moduleDetailsMore" type="button">
              Open entity
            </button>
          </div>
        </div>

        <div class="controls">
          <label
            class="start-field"
            title="Start at this module position (1 = leftmost)"
          >
            <span class="start-label">Start</span>
            <input
              id="startInput"
              class="start-input"
              type="number"
              min="1"
              step="1"
              value="1"
              inputmode="numeric"
              aria-label="Start module position"
            />
          </label>
          <input
            id="textInput"
            class="text-input"
            type="text"
            placeholder="Enter text to display..."
            autocomplete="off"
          />
          <button id="sendBtn" class="btn btn-primary" type="button">Send</button>
        </div>

        <div class="feedback" id="feedback" role="status"></div>

        <div class="actions-row">
          <button id="syncBtn" class="btn btn-secondary" type="button">Sync State</button>
          <button id="scanBtn" class="btn btn-secondary" type="button">Scan Bus</button>
        </div>
      </ha-card>
    `;

    this._refs = {
      title: this.shadowRoot.getElementById("cardTitle"),
      statusBadge: this.shadowRoot.getElementById("statusBadge"),
      modulesCount: this.shadowRoot.getElementById("modulesCountSpan"),
      flapTiles: this.shadowRoot.getElementById("flapTiles"),
      boardFooter: this.shadowRoot.getElementById("boardFooter"),
      input: this.shadowRoot.getElementById("textInput"),
      startInput: this.shadowRoot.getElementById("startInput"),
      sendBtn: this.shadowRoot.getElementById("sendBtn"),
      feedback: this.shadowRoot.getElementById("feedback"),
      syncBtn: this.shadowRoot.getElementById("syncBtn"),
      scanBtn: this.shadowRoot.getElementById("scanBtn"),
      settingsToggle: this.shadowRoot.getElementById("settingsToggle"),
      layoutSettings: this.shadowRoot.getElementById("layoutSettings"),
      columnsInput: this.shadowRoot.getElementById("columnsInput"),
      ratioInput: this.shadowRoot.getElementById("ratioInput"),
      gapInput: this.shadowRoot.getElementById("gapInput"),
      layoutResetBtn: this.shadowRoot.getElementById("layoutResetBtn"),
      moduleDetails: this.shadowRoot.getElementById("moduleDetails"),
      moduleDetailsBackdrop: this.shadowRoot.getElementById(
        "moduleDetailsBackdrop"
      ),
      moduleDetailsTitle: this.shadowRoot.getElementById("moduleDetailsTitle"),
      moduleDetailsBody: this.shadowRoot.getElementById("moduleDetailsBody"),
      moduleDetailsClose: this.shadowRoot.getElementById("moduleDetailsClose"),
      moduleDetailsStart: this.shadowRoot.getElementById("moduleDetailsStart"),
      moduleDetailsMore: this.shadowRoot.getElementById("moduleDetailsMore"),
    };

    this._refs.sendBtn.addEventListener("click", () => this._sendText());
    this._refs.input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        this._sendText();
      }
    });
    this._refs.syncBtn.addEventListener("click", () =>
      this._pressButton(
        this._config.sync_entity,
        ENTITY_PATTERNS.sync,
        "sync"
      )
    );
    this._refs.scanBtn.addEventListener("click", () =>
      this._pressButton(
        this._config.scan_entity,
        ENTITY_PATTERNS.scan,
        "scan"
      )
    );

    this._refs.settingsToggle.addEventListener("click", () => {
      this._settingsOpen = !this._settingsOpen;
      this._refs.layoutSettings.hidden = !this._settingsOpen;
      this._refs.settingsToggle.classList.toggle(
        "active",
        this._settingsOpen
      );
      this._refs.settingsToggle.setAttribute(
        "aria-expanded",
        this._settingsOpen ? "true" : "false"
      );
      if (this._settingsOpen) this._updateLayoutInputs();
    });

    const applyLayoutInputs = () => {
      this._layout = {
        columns: this._parseColumns(this._refs.columnsInput.value),
        ratio: this._parseRatio(this._refs.ratioInput.value),
        gap: this._parseGap(this._refs.gapInput.value),
      };
      this._saveLayout();
      this._layoutSignature = "";
      this._applyLayout();
    };

    this._refs.columnsInput.addEventListener("change", applyLayoutInputs);
    this._refs.ratioInput.addEventListener("change", applyLayoutInputs);
    this._refs.gapInput.addEventListener("change", applyLayoutInputs);

    this._refs.layoutResetBtn.addEventListener("click", () => {
      this._resetLayout();
      this._showFeedback("Layout reset");
    });

    this._refs.moduleDetailsClose.addEventListener("click", () => {
      this._closeModuleDetails();
    });

    this._refs.moduleDetailsBackdrop.addEventListener("click", () => {
      this._closeModuleDetails();
    });

    this._refs.moduleDetailsStart.addEventListener("click", () =>
      this._useSelectedAsStart()
    );

    this._refs.moduleDetailsMore.addEventListener("click", () => {
      if (this._selectedEntityId) this._openMoreInfo(this._selectedEntityId);
    });

    this._layoutSignature = "";
    this._settingsOpen = false;
    this._skeletonBuilt = true;
  }

  _closeModuleDetails() {
    this._selectedModuleId = undefined;
    this._selectedModule = undefined;
    this._selectedEntityId = undefined;
    this._detailsSignature = "";
    this.render();
  }

  _useSelectedAsStart() {
    const module = this._selectedModule;
    if (!module || !this._refs.startInput) return;
    const position = module.displayPosition || 1;
    this._refs.startInput.value = String(position);
    // Close the modal first: its backdrop would otherwise cover the text input.
    this._closeModuleDetails();
    this._refs.input.focus();
    this._showFeedback(`Text will start at module ${position}`);
  }

  _openMoreInfo(entityId) {
    this.dispatchEvent(
      new CustomEvent("hass-more-info", {
        detail: { entityId },
        bubbles: true,
        composed: true,
      })
    );
  }

  _toggleModuleDetails(module) {
    if (!module) return;

    if (String(this._selectedModuleId) === String(module.id)) {
      this._selectedModuleId = undefined;
      this._selectedModule = undefined;
      this._selectedEntityId = undefined;
    } else {
      this._selectedModuleId = String(module.id);
      this._selectedModule = module;
      this._selectedEntityId = module.entityId;
    }

    this._detailsSignature = "";
    this.render();
  }

  _updateHeader(masterStatus, modulesCount) {
    const title = this._config.title || DEFAULT_CONFIG.title;
    if (this._refs.title && this._refs.title.textContent !== title) {
      this._refs.title.textContent = title;
    }

    if (this._refs.statusBadge) {
      const online = isOnlineState(masterStatus);
      const label = String(masterStatus || "offline").toUpperCase();
      if (this._refs.statusBadge.textContent !== label) {
        this._refs.statusBadge.textContent = label;
      }
      this._refs.statusBadge.classList.toggle("badge-online", online);
      this._refs.statusBadge.classList.toggle("badge-offline", !online);
    }

    if (this._refs.modulesCount) {
      const count = Math.max(Number(modulesCount) || 0, 0);
      const label = `${count} module${count === 1 ? "" : "s"}`;
      if (this._refs.modulesCount.textContent !== label) {
        this._refs.modulesCount.textContent = label;
      }
    }
  }

  _updateFlaps(text, modules, modulesCount, showOptimistic = false) {
    const container = this._refs.flapTiles;
    if (!container) return;

    const upperText = String(text ?? "").toUpperCase();

    if (modules.length > 0) {
      const signature = modules
        .map((module) => `${module.entityId || ""}:${module.id}`)
        .join("|");

      if (
        signature !== this._moduleSignature ||
        container.children.length !== modules.length
      ) {
        container.replaceChildren(
          ...modules.map((module) => this._createModuleTile(module))
        );
        this._moduleSignature = signature;
        this._fallbackSignature = "";
      }

      modules.forEach((module, index) => {
        const tile = container.children[index];
        if (!tile) return;

        tile.classList.toggle(
          "selected",
          String(module.id) === String(this._selectedModuleId)
        );

        let char = "";
        if (showOptimistic) {
          char = index < upperText.length ? upperText[index] : "";
        } else if (module.hasFlap) {
          char = module.flap;
        } else if (index < upperText.length) {
          char = upperText[index];
        }

        this._setTileContent(tile, char, module);
      });
      return;
    }

    // No hardware module data yet: render a simple text preview instead.
    const textChars = upperText.length > 0 ? Array.from(upperText) : [];
    const placeholderCount =
      modulesCount > 0 ? modulesCount : Math.max(textChars.length, 4);
    const chars = new Array(placeholderCount)
      .fill(" ")
      .map((blank, index) =>
        index < textChars.length ? textChars[index] : blank
      );
    const signature = `fallback:${chars.length}`;

    if (
      signature !== this._fallbackSignature ||
      container.children.length !== chars.length
    ) {
      container.replaceChildren(...chars.map(() => this._createFallbackTile()));
      this._fallbackSignature = signature;
      this._moduleSignature = "";
    }

    chars.forEach((char, index) => {
      const tile = container.children[index];
      if (!tile) return;
      this._setTileContent(tile, char);
    });
  }

  _createModuleTile(module) {
    const tile = document.createElement("div");
    tile.className = "flap-tile";
    tile.dataset.moduleId = module.id;

    const char = document.createElement("span");
    char.className = "flap-char";

    const label = document.createElement("span");
    label.className = "module-sublabel";

    tile.append(char, label);

    tile.classList.add("clickable");
    if (module.entityId) tile.dataset.entityId = module.entityId;
    tile.setAttribute("role", "button");
    tile.tabIndex = 0;

    const toggleDetails = () => this._toggleModuleDetails(module);

    tile.addEventListener("click", toggleDetails);
    tile.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        toggleDetails();
      }
    });

    return tile;
  }

  _createFallbackTile() {
    const tile = document.createElement("div");
    tile.className = "flap-tile placeholder";
    const char = document.createElement("span");
    char.className = "flap-char";
    tile.append(char);
    return tile;
  }

  _setTileContent(tile, value, module) {
    const char = tile.querySelector(".flap-char");
    const codepoint = firstCodePoint(value);
    const display =
      codepoint === "" || codepoint === " " || codepoint === "\u00a0"
        ? "\u00a0"
        : codepoint;

    if (char && char.textContent !== display) {
      char.textContent = display;
    }

    const label = tile.querySelector(".module-sublabel");
    if (label && module) {
      const labelText = `#${module.id}`;
      if (label.textContent !== labelText) label.textContent = labelText;
    }

    if (module) {
      const stateText = module.state || "unknown";
      const slotText = module.displayPosition
        ? `, slot ${module.displayPosition}`
        : "";
      const positionText =
        module.position !== undefined && module.position !== null
          ? `, bus position ${module.position}`
          : "";
      const detailParts = [];
      if (module.currentStep !== undefined && module.currentStep !== null) {
        detailParts.push(`step ${module.currentStep}`);
      }
      if (module.autoHoming !== undefined && module.autoHoming !== null) {
        detailParts.push(`auto-home ${module.autoHoming ? "on" : "off"}`);
      }
      if (module.flapCount) detailParts.push(`${module.flapCount} flaps`);
      if (module.mapCount) detailParts.push(`${module.mapCount} mapped`);
      const detailText = detailParts.length
        ? `, ${detailParts.join(", ")}`
        : "";
      const entityText = module.entityId ? `\n${module.entityId}` : "";
      const hintText = "\nClick or tap for module details";
      const title = `Module #${module.id} (${stateText}${slotText}${positionText}${detailText})${hintText}${entityText}`;
      if (tile.title !== title) tile.title = title;
      tile.setAttribute("aria-label", title);
    }
  }

  _formatDetailValue(value) {
    if (typeof value === "boolean") return value ? "On" : "Off";
    if (Array.isArray(value)) return value.join(", ");
    if (value && typeof value === "object") return JSON.stringify(value);
    return String(value);
  }

  _createDetailItem(label, value, wide = false) {
    const item = document.createElement("div");
    item.className = wide ? "detail-item wide" : "detail-item";

    const labelElement = document.createElement("span");
    labelElement.className = "detail-label";
    labelElement.textContent = label;

    const valueElement = document.createElement("span");
    valueElement.className = wide ? "detail-value mono" : "detail-value";
    valueElement.textContent = value;

    item.append(labelElement, valueElement);
    return item;
  }

  _firstValue(source, keys) {
    if (!source) return undefined;
    for (const key of keys) {
      const value = source[key];
      if (value !== undefined && value !== null) return value;
    }
    return undefined;
  }

  _updateModuleDetails(modules) {
    const panel = this._refs.moduleDetails;
    if (!panel) return;

    const selected =
      this._selectedModuleId === undefined
        ? undefined
        : modules.find(
            (module) => String(module.id) === String(this._selectedModuleId)
          );

    if (!selected) {
      panel.hidden = true;
      if (this._refs.moduleDetailsBackdrop) {
        this._refs.moduleDetailsBackdrop.hidden = true;
      }
      this._selectedModule = undefined;
      this._detailsSignature = "";
      return;
    }

    this._selectedModule = selected;

    const stateObj = selected.entityId
      ? this._hass.states[selected.entityId]
      : undefined;
    const attrs =
      stateObj && stateObj.attributes
        ? stateObj.attributes
        : selected.raw && typeof selected.raw === "object"
          ? selected.raw
          : {};
    const signature = JSON.stringify({
      id: selected.id,
      entityId: selected.entityId,
      displayPosition: selected.displayPosition,
      attrs,
    });

    if (signature === this._detailsSignature) {
      panel.hidden = false;
      if (this._refs.moduleDetailsBackdrop) {
        this._refs.moduleDetailsBackdrop.hidden = false;
      }
      return;
    }
    this._detailsSignature = signature;
    this._selectedEntityId = selected.entityId;

    const titleParts = [`Module #${selected.id}`];
    if (selected.displayPosition) {
      titleParts.push(`slot ${selected.displayPosition}`);
    }
    this._refs.moduleDetailsTitle.textContent = titleParts.join(" · ");

    const body = this._refs.moduleDetailsBody;
    body.replaceChildren();

    const rows = [
      [
        "State",
        this._firstValue(attrs, ["module_state", "state", "status"]) ??
          selected.state,
      ],
      ["Slot", selected.displayPosition],
      [
        "Bus position",
        this._firstValue(attrs, ["position"]) ?? selected.position,
      ],
      ["Flap", this._firstValue(attrs, ["flap"]) ?? selected.flap],
      [
        "Flap index",
        this._firstValue(attrs, MODULE_STAT_ALIASES.current_index),
      ],
      ["Flap position", this._firstValue(attrs, ["flap_position"])],
      [
        "Current step",
        this._firstValue(attrs, MODULE_STAT_ALIASES.current_step),
      ],
      [
        "Auto homing",
        this._firstValue(attrs, MODULE_STAT_ALIASES.auto_homing),
      ],
      ["Online", this._firstValue(attrs, MODULE_STAT_ALIASES.online)],
      [
        "Home offset",
        this._firstValue(attrs, MODULE_STAT_ALIASES.home_offset),
      ],
      [
        "Total steps",
        this._firstValue(attrs, MODULE_STAT_ALIASES.total_steps),
      ],
      ["Last seen", this._firstValue(attrs, MODULE_STAT_ALIASES.last_seen)],
      ["Entity", selected.entityId || "Card only (no HA entity)"],
    ];

    for (const [label, value] of rows) {
      if (value === undefined || value === null || value === "") continue;
      body.append(this._createDetailItem(label, this._formatDetailValue(value)));
    }

    const flapList = this._firstValue(attrs, MODULE_STAT_ALIASES.flap_list);
    const flapChars =
      typeof flapList === "string"
        ? Array.from(flapList)
        : Array.isArray(flapList)
          ? flapList
          : undefined;
    if (flapChars && flapChars.length) {
      body.append(
        this._createDetailItem(
          `Flap array (${flapChars.length})`,
          flapChars.join(""),
          true
        )
      );
    }

    const positionMap = this._firstValue(
      attrs,
      MODULE_STAT_ALIASES.map_of_positions
    );
    if (positionMap && typeof positionMap === "object") {
      const entries = Object.entries(positionMap).sort(([a], [b]) =>
        compareModuleIds(a, b)
      );
      if (entries.length) {
        const item = document.createElement("div");
        item.className = "detail-item wide";

        const label = document.createElement("span");
        label.className = "detail-label";
        label.textContent = `Position map (${entries.length})`;

        const map = document.createElement("div");
        map.className = "detail-map";
        for (const [index, position] of entries) {
          const entry = document.createElement("span");
          entry.className = "detail-map-entry";
          entry.textContent = `${index}: ${this._formatDetailValue(position)}`;
          map.append(entry);
        }

        item.append(label, map);
        body.append(item);
      }
    } else if (typeof positionMap === "string" && positionMap) {
      body.append(
        this._createDetailItem("Position map", positionMap, true)
      );
    }

    const extra = {};
    if (attrs.extra_stats && typeof attrs.extra_stats === "object") {
      Object.assign(extra, attrs.extra_stats);
    }
    for (const [key, value] of Object.entries(attrs)) {
      if (!MODULE_KNOWN_KEYS.has(key) && value !== undefined && value !== null) {
        extra[key] = value;
      }
    }
    if (Object.keys(extra).length) {
      body.append(
        this._createDetailItem(
          "Additional data",
          JSON.stringify(extra, null, 2),
          true
        )
      );
    }

    this._refs.moduleDetailsMore.hidden = !selected.entityId;
    if (this._refs.moduleDetailsBackdrop) {
      this._refs.moduleDetailsBackdrop.hidden = false;
    }
    panel.hidden = false;
  }

  _updateOverflowHint(text, modules, modulesCount) {
    const footer = this._refs.boardFooter;
    if (!footer) return;

    const moduleCount = modules.length > 0 ? modules.length : modulesCount || 0;
    if (moduleCount > 0 && text.length > moduleCount) {
      const extra = text.length - moduleCount;
      footer.textContent = `Text is ${extra} character${
        extra === 1 ? "" : "s"
      } longer than the ${moduleCount} available module${
        moduleCount === 1 ? "" : "s"
      }; only the beginning is shown.`;
      footer.classList.add("visible");
    } else {
      footer.textContent = "";
      footer.classList.remove("visible");
    }
  }
}

// Register custom card with Lovelace safely (prevent duplicate registration errors)
if (!customElements.get("splitflap-card")) {
  customElements.define("splitflap-card", SplitFlapCard);
}

// Lovelace Card Picker helper
window.customCards = window.customCards || [];
if (!window.customCards.some((card) => card.type === "splitflap-card")) {
  window.customCards.push({
    type: "splitflap-card",
    name: "SplitFlap Display Card",
    description:
      "Interactive controller and split-flap tile viewer for ESP32 SplitFlap displays.",
    preview: true,
    documentationURL: "https://github.com/H0u0uinKy0um4/SplitFlapHASC",
  });
}

console.info(
  `%c SPLITFLAP-CARD %c ${SPLITFLAP_CARD_VERSION} `,
  "color: #03a9f4; background: #111114; font-weight: 700;",
  "color: #111114; background: #03a9f4; font-weight: 700;"
);
