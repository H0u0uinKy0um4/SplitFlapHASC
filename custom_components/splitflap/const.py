"""Constants for the SplitFlap integration."""
from typing import Final
from homeassistant.const import Platform

DOMAIN: Final = "splitflap"
DEFAULT_NAME: Final = "SplitFlap"
DEFAULT_TOPIC_PREFIX: Final = "splitflap"

FRONTEND_VERSION: Final = "1.3.0"
FRONTEND_URL_PATH: Final = "/splitflap/splitflap-card.js"

CONF_TOPIC_PREFIX: Final = "topic_prefix"

# Last known state persistence (Home Assistant .storage).
STORAGE_VERSION: Final = 1
STORAGE_SAVE_DELAY: Final = 10

PLATFORMS: Final = [
    Platform.SENSOR,
    Platform.BUTTON,
    Platform.TEXT,
]
