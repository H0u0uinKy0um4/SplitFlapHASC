/**
 * SplitFlap Card for Home Assistant
 * Interactive Lovelace card displaying split-flap tiles and control buttons.
 */

class SplitFlapCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  setConfig(config) {
    this._config = {
      title: 'SplitFlap Display',
      text_entity: 'text.splitflap_display_text',
      status_entity: 'sensor.splitflap_master_status',
      modules_sensor: 'sensor.splitflap_detected_modules',
      sync_entity: 'button.splitflap_sync',
      scan_entity: 'button.splitflap_scan',
      ...config,
    };
    // Also accept generic 'entity' key
    if (config.entity && !config.text_entity) {
      this._config.text_entity = config.entity;
    }
  }

  set hass(hass) {
    this._hass = hass;
    this.render();
  }

  _resolveEntityId(primary, fallback) {
    if (this._hass && this._hass.states[primary]) return primary;
    if (this._hass && fallback && this._hass.states[fallback]) return fallback;
    return primary;
  }

  _sendText() {
    const input = this.shadowRoot.getElementById('textInput');
    if (!input) return;
    const val = input.value.trim();
    if (!val) return;

    const textEntity = this._resolveEntityId(this._config.text_entity, 'text.splitflap_display_text');
    this._hass.callService('text', 'set_value', {
      entity_id: textEntity,
      value: val,
    });
    input.value = '';
  }

  _pressButton(primary, fallback) {
    const entity = this._resolveEntityId(primary, fallback);
    this._hass.callService('button', 'press', {
      entity_id: entity,
    });
  }

  render() {
    if (!this._hass || !this._config) return;

    const textEntityId = this._resolveEntityId(this._config.text_entity, 'text.splitflap_display_text');
    const statusEntityId = this._resolveEntityId(this._config.status_entity, 'sensor.splitflap_master_status');
    const modulesEntityId = this._resolveEntityId(this._config.modules_sensor, 'sensor.splitflap_detected_modules');
    const syncEntityId = this._resolveEntityId(this._config.sync_entity, 'button.splitflap_sync_modules');
    const scanEntityId = this._resolveEntityId(this._config.scan_entity, 'button.splitflap_bus_scan');

    const textState = this._hass.states[textEntityId];
    const statusState = this._hass.states[statusEntityId];
    const modulesState = this._hass.states[modulesEntityId];

    const currentText = textState ? textState.state : '';
    const masterStatus = statusState ? statusState.state : 'offline';
    const modulesCount = modulesState ? modulesState.state : '0';
    const modulesData = modulesState && modulesState.attributes && modulesState.attributes.modules
      ? modulesState.attributes.modules
      : {};

    const isOnline = masterStatus.toLowerCase() === 'online';

    // If already rendered structure, only update dynamic elements to avoid losing focus
    const card = this.shadowRoot.querySelector('ha-card');
    if (card) {
      const statusBadge = this.shadowRoot.getElementById('statusBadge');
      if (statusBadge) {
        statusBadge.textContent = masterStatus.toUpperCase();
        statusBadge.className = `badge ${isOnline ? 'badge-online' : 'badge-offline'}`;
      }

      const flapContainer = this.shadowRoot.getElementById('flapTiles');
      if (flapContainer) {
        flapContainer.innerHTML = this._generateFlapTilesHtml(currentText, modulesData);
      }

      const modCountSpan = this.shadowRoot.getElementById('modulesCountSpan');
      if (modCountSpan) {
        modCountSpan.textContent = `${modulesCount} modules`;
      }
      return;
    }

    // Initial render
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
          box-shadow: var(--ha-card-box-shadow, 0 4px 12px rgba(0,0,0,0.15));
          font-family: var(--paper-font-body1_-_font-family, system-ui, sans-serif);
        }
        .header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 16px;
        }
        .title {
          font-size: 1.15rem;
          font-weight: 600;
          letter-spacing: 0.5px;
        }
        .badge {
          font-size: 0.72rem;
          padding: 3px 8px;
          border-radius: 999px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.5px;
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
        /* Split-flap display area */
        .board-container {
          background: #111114;
          padding: 16px;
          border-radius: 8px;
          border: 1px solid #2d2d35;
          margin-bottom: 16px;
          box-shadow: inset 0 2px 6px rgba(0,0,0,0.4);
        }
        .board-header {
          display: flex;
          justify-content: space-between;
          font-size: 0.75rem;
          color: var(--secondary-text-color, #8e8e93);
          margin-bottom: 8px;
          text-transform: uppercase;
        }
        .flap-row {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          min-height: 52px;
          align-items: center;
        }
        .flap-tile {
          position: relative;
          width: 38px;
          height: 52px;
          background: #222228;
          border-radius: 5px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: 'SF Mono', Monaco, 'Courier New', monospace;
          font-size: 1.8rem;
          font-weight: 700;
          color: #f5f5f7;
          border: 1px solid #33333d;
          box-shadow: 0 4px 6px rgba(0,0,0,0.3);
          user-select: none;
        }
        /* Authentic split line across flap */
        .flap-tile::after {
          content: '';
          position: absolute;
          left: 0;
          right: 0;
          top: 50%;
          height: 1.5px;
          background: rgba(0, 0, 0, 0.75);
          box-shadow: 0 1px 0 rgba(255, 255, 255, 0.08);
        }
        .module-sublabel {
          position: absolute;
          bottom: 2px;
          font-size: 0.55rem;
          color: #777782;
          font-family: sans-serif;
          font-weight: 400;
        }
        /* Input & Controls */
        .controls {
          display: flex;
          gap: 8px;
          margin-bottom: 12px;
        }
        .text-input {
          flex: 1;
          padding: 10px 14px;
          border: 1px solid var(--divider-color, #383842);
          background: var(--card-background-color, #26262e);
          color: var(--primary-text-color, #fff);
          border-radius: 6px;
          font-size: 0.95rem;
          outline: none;
          transition: border-color 0.2s;
        }
        .text-input:focus {
          border-color: var(--primary-color, #03a9f4);
        }
        .btn {
          cursor: pointer;
          border: none;
          border-radius: 6px;
          font-weight: 600;
          padding: 10px 16px;
          font-size: 0.9rem;
          transition: opacity 0.2s, background-color 0.2s;
        }
        .btn:hover {
          opacity: 0.88;
        }
        .btn-primary {
          background: var(--primary-color, #03a9f4);
          color: var(--text-primary-color, #ffffff);
        }
        .actions-row {
          display: flex;
          gap: 8px;
          border-top: 1px solid var(--divider-color, rgba(255,255,255,0.08));
          padding-top: 12px;
        }
        .btn-secondary {
          flex: 1;
          padding: 8px 12px;
          background: var(--secondary-background-color, #2b2b34);
          color: var(--primary-text-color, #ececec);
          border: 1px solid var(--divider-color, #3a3a46);
          font-size: 0.82rem;
        }
      </style>

      <ha-card>
        <div class="header">
          <div class="title">${this._config.title}</div>
          <span id="statusBadge" class="badge ${isOnline ? 'badge-online' : 'badge-offline'}">
            ${masterStatus.toUpperCase()}
          </span>
        </div>

        <div class="board-container">
          <div class="board-header">
            <span>Display Preview</span>
            <span id="modulesCountSpan">${modulesCount} modules</span>
          </div>
          <div class="flap-row" id="flapTiles">
            ${this._generateFlapTilesHtml(currentText, modulesData)}
          </div>
        </div>

        <div class="controls">
          <input
            id="textInput"
            class="text-input"
            type="text"
            placeholder="Enter text to display..."
            autocomplete="off"
          />
          <button id="sendBtn" class="btn btn-primary">Send</button>
        </div>

        <div class="actions-row">
          <button id="syncBtn" class="btn btn-secondary">Sync State</button>
          <button id="scanBtn" class="btn btn-secondary">Scan Bus</button>
        </div>
      </ha-card>
    `;

    // Bind event listeners
    this.shadowRoot.getElementById('sendBtn').addEventListener('click', () => this._sendText());
    this.shadowRoot.getElementById('textInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        this._sendText();
      }
    });

    this.shadowRoot.getElementById('syncBtn').addEventListener('click', () => {
      this._pressButton(this._config.sync_entity, syncEntityId);
    });

    this.shadowRoot.getElementById('scanBtn').addEventListener('click', () => {
      this._pressButton(this._config.scan_entity, scanEntityId);
    });
  }

  _generateFlapTilesHtml(text, modulesData) {
    const moduleKeys = Object.keys(modulesData || {});

    // If hardware modules are reported, show each module's flap
    if (moduleKeys.length > 0) {
      return moduleKeys
        .sort((a, b) => Number(a) - Number(b))
        .map((id) => {
          const mod = modulesData[id];
          const char = (mod && mod.flap !== undefined && mod.flap !== '') ? String(mod.flap) : ' ';
          return `
            <div class="flap-tile" title="Module #${id} (${mod ? mod.state : 'unknown'})">
              ${char}
              <span class="module-sublabel">#${id}</span>
            </div>
          `;
        })
        .join('');
    }

    // Fallback: render the text string character by character
    const chars = (text && text.length > 0) ? text.toUpperCase().split('') : [' '];
    return chars
      .map(
        (c) => `<div class="flap-tile">${c === ' ' ? '&nbsp;' : c}</div>`
      )
      .join('');
  }

  getCardSize() {
    return 3;
  }
}

// Register custom card with Lovelace safely (prevent duplicate registration errors)
if (!customElements.get('splitflap-card')) {
  customElements.define('splitflap-card', SplitFlapCard);
}

// Lovelace Card Picker helper
window.customCards = window.customCards || [];
if (!window.customCards.some((c) => c.type === 'splitflap-card')) {
  window.customCards.push({
    type: 'splitflap-card',
    name: 'SplitFlap Display Card',
    description: 'Interactive controller and split-flap tile viewer for ESP32 SplitFlap displays.',
    preview: true,
  });
}
