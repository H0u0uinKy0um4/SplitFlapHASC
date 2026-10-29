"""Constants for the SplitFlap integration."""
from typing import Final
from homeassistant.const import Platform

DOMAIN: Final = "splitflap"
DEFAULT_NAME: Final = "SplitFlap"
DEFAULT_TOPIC_PREFIX: Final = "splitflap"

FRONTEND_VERSION: Final = "1.2.0"
FRONTEND_URL_PATH: Final = "/splitflap/splitflap-card.js"

CONF_TOPIC_PREFIX: Final = "topic_prefix"

PLATFORMS: Final = [
    Platform.SENSOR,
    Platform.BUTTON,
    Platform.TEXT,
]
