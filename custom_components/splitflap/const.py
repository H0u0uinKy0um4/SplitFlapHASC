"""Constants for the SplitFlap integration."""
from typing import Final
from homeassistant.const import Platform

DOMAIN: Final = "splitflap"
DEFAULT_NAME: Final = "SplitFlap"
DEFAULT_TOPIC_PREFIX: Final = "splitflap"

CONF_TOPIC_PREFIX: Final = "topic_prefix"

PLATFORMS: Final = [
    Platform.SENSOR,
    Platform.BUTTON,
    Platform.TEXT,
]
