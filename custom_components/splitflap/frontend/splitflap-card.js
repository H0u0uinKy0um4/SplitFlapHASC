/**
 * SplitFlap Card for Home Assistant
 * Interactive Lovelace card displaying split-flap tiles and control buttons.
 *
 * Each hardware module is rendered as its own tile. When the integration
 * exposes per-module sensor entities, tiles are linked to those entities and
 * clicking a tile opens the normal Home Assistant more-info dialog.
 */

const SPLITFLAP_CARD_VERSION = "1.2.0";
const MODULE_ID_ATTR = "splitflap_module_id";
const MODULE_PREFIX_ATTR = "splitflap_prefix";

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

const DEFAULT_CONFIG = {
  title: "SplitFlap Display",
  text_entity: "text.splitflap_display_text",
  status_entity: "sensor.splitflap_master_status",
  modules_sensor: "sensor.splitflap_detected_modules",
  sync_entity: "button.splitflap_sync",
  scan_entity: "button.splitflap_scan",
  module_entities: [],
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
    this._refs = {};
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

    this._optimisticText = undefined;
    this._clearOptimisticTimer();
    this._moduleSignature = "";
    this._fallbackSignature = "";
    this._skeletonBuilt = false;

    if (this._hass) this.render();
  }

  set hass(hass) {
    this._hass = hass;
    this.render();
  }

  getCardSize() {
    return 4;
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
    this._optimisticText = value;
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
              value,
            })
          : this._hass.callService("splitflap", "send_text", { text: value });

      Promise.resolve(request)
        .then(() => {
          this._showFeedback(value ? "Text sent" : "Display cleared");
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

    return Array.from(modulesById.values()).sort((a, b) =>
      compareModuleIds(a.id, b.id)
    );
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

    if (!this._skeletonBuilt) {
      this._buildSkeleton();
    }

    this._updateHeader(masterStatus, modulesCount);
    this._updateFlaps(currentText, modules, modulesCount, showOptimistic);
    this._updateOverflowHint(currentText, modules, modulesCount);
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
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(28px, 52px));
          justify-content: center;
          align-items: center;
          gap: clamp(3px, 1.2vw, 6px);
          min-height: 52px;
        }
        .flap-tile {
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 100%;
          aspect-ratio: 38 / 52;
          overflow: hidden;
          background: #222228;
          border: 1px solid #33333d;
          border-radius: 5px;
          box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
          color: #f5f5f7;
          container-type: inline-size;
          user-select: none;
        }
        .flap-tile.has-entity {
          cursor: pointer;
        }
        .flap-tile.has-entity:hover {
          border-color: var(--primary-color, #03a9f4);
        }
        .flap-tile.has-entity:focus-visible {
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
        .controls {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-bottom: 8px;
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
          <span id="statusBadge" class="badge badge-offline"></span>
        </div>

        <div class="board-container">
          <div class="board-header">
            <span>Display Preview</span>
            <span id="modulesCountSpan"></span>
          </div>
          <div class="flap-row" id="flapTiles"></div>
          <div class="board-footer" id="boardFooter"></div>
        </div>

        <div class="controls">
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
      sendBtn: this.shadowRoot.getElementById("sendBtn"),
      feedback: this.shadowRoot.getElementById("feedback"),
      syncBtn: this.shadowRoot.getElementById("syncBtn"),
      scanBtn: this.shadowRoot.getElementById("scanBtn"),
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

    this._skeletonBuilt = true;
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

    if (module.entityId) {
      tile.classList.add("has-entity");
      tile.dataset.entityId = module.entityId;
      tile.setAttribute("role", "button");
      tile.tabIndex = 0;

      const openMoreInfo = () => {
        this.dispatchEvent(
          new CustomEvent("hass-more-info", {
            detail: { entityId: module.entityId },
            bubbles: true,
            composed: true,
          })
        );
      };

      tile.addEventListener("click", openMoreInfo);
      tile.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openMoreInfo();
        }
      });
    }

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
      const positionText =
        module.position !== undefined && module.position !== null
          ? `, position ${module.position}`
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
      const hintText = module.entityId ? "\nClick for full details" : "";
      const title = `Module #${module.id} (${stateText}${positionText}${detailText})${hintText}${entityText}`;
      if (tile.title !== title) tile.title = title;
      tile.setAttribute("aria-label", title);
    }
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
