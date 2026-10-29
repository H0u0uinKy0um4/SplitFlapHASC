"""Config flow for SplitFlap integration."""
from __future__ import annotations

from typing import Any
import voluptuous as vol

from homeassistant import config_entries
from homeassistant.core import callback
from homeassistant.data_entry_flow import FlowResult

from .const import CONF_TOPIC_PREFIX, DEFAULT_TOPIC_PREFIX, DOMAIN

STEP_USER_DATA_SCHEMA = vol.Schema(
    {
        vol.Required(CONF_TOPIC_PREFIX, default=DEFAULT_TOPIC_PREFIX): str,
    }
)


class SplitFlapConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle a config flow for SplitFlap."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """Handle the initial step."""
        errors: dict[str, str] = {}

        if user_input is not None:
            topic_prefix = user_input[CONF_TOPIC_PREFIX].strip().rstrip("/")
            if not topic_prefix:
                errors[CONF_TOPIC_PREFIX] = "invalid_topic_prefix"
            else:
                await self.async_set_unique_id(topic_prefix)
                self._abort_if_unique_id_configured()

                return self.async_create_entry(
                    title=f"SplitFlap ({topic_prefix})",
                    data={CONF_TOPIC_PREFIX: topic_prefix},
                )

        return self.async_show_form(
            step_id="user",
            data_schema=STEP_USER_DATA_SCHEMA,
            errors=errors,
        )

    @staticmethod
    @callback
    def async_get_options_flow(
        config_entry: config_entries.ConfigEntry,
    ) -> config_entries.OptionsFlow:
        """Get the options flow for this handler."""
        return SplitFlapOptionsFlowHandler(config_entry)


class SplitFlapOptionsFlowHandler(config_entries.OptionsFlow):
    """Handle SplitFlap options."""

    def __init__(self, config_entry: config_entries.ConfigEntry) -> None:
        """Initialize options flow."""
        self._config_entry = config_entry

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """Manage the options."""
        errors: dict[str, str] = {}

        if user_input is not None:
            return self.async_create_entry(title="", data=user_input)

        current_prefix = self._config_entry.options.get(
            CONF_TOPIC_PREFIX,
            self._config_entry.data.get(CONF_TOPIC_PREFIX, DEFAULT_TOPIC_PREFIX),
        )

        schema = vol.Schema(
            {
                vol.Required(CONF_TOPIC_PREFIX, default=current_prefix): str,
            }
        )

        return self.async_show_form(
            step_id="init",
            data_schema=schema,
            errors=errors,
        )
