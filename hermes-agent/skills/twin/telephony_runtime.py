from __future__ import annotations

import json
import os
from typing import Any

import requests

from .interfaces import TwinTelephonyRuntime
from .models import DelegationTask, TwinProfile


class ElevenLabsConvAIRuntime(TwinTelephonyRuntime):
    """Outbound telephony runtime backed by ElevenLabs ConvAI + Twilio."""

    def __init__(self) -> None:
        self.api_key = os.environ.get("ELEVENLABS_API_KEY", "")
        self.agent_id = os.environ.get("ELEVENLABS_AGENT_ID", "")
        self.phone_number_id = os.environ.get("ELEVENLABS_PHONE_NUMBER_ID", "")
        self.llm_mode = os.environ.get("TWIN_TELEPHONY_LLM_MODE", "native").strip().lower() or "native"
        self.native_llm = os.environ.get("TWIN_TELEPHONY_LLM", "gemini-2.5-flash").strip() or "gemini-2.5-flash"
        self.llm_temperature = self._read_float_env("TWIN_TELEPHONY_LLM_TEMPERATURE", 0.0)
        self.custom_llm_url = os.environ.get("TWIN_TELEPHONY_CUSTOM_LLM_URL", os.environ.get("KIMI_BASE_URL", "")).strip()
        self.custom_llm_model_id = os.environ.get(
            "TWIN_TELEPHONY_CUSTOM_LLM_MODEL_ID",
            os.environ.get("TWIN_KIMI_GENERATION_MODEL", ""),
        ).strip()
        self.custom_llm_secret_id = os.environ.get("TWIN_TELEPHONY_CUSTOM_LLM_SECRET_ID", "").strip()
        self.custom_llm_headers = self._read_json_env("TWIN_TELEPHONY_CUSTOM_LLM_HEADERS")

    def validate(self) -> None:
        if not self.api_key:
            raise RuntimeError("ELEVENLABS_API_KEY is not configured.")
        if not self.agent_id:
            raise RuntimeError("ELEVENLABS_AGENT_ID is not configured.")
        if not self.phone_number_id:
            raise RuntimeError("ELEVENLABS_PHONE_NUMBER_ID is not configured.")
        if self.llm_mode not in {"native", "custom"}:
            raise RuntimeError("TWIN_TELEPHONY_LLM_MODE must be 'native' or 'custom'.")
        if self.llm_mode == "custom":
            missing: list[str] = []
            if not self.custom_llm_url:
                missing.append("TWIN_TELEPHONY_CUSTOM_LLM_URL")
            if not self.custom_llm_model_id:
                missing.append("TWIN_TELEPHONY_CUSTOM_LLM_MODEL_ID")
            if not self.custom_llm_secret_id:
                missing.append("TWIN_TELEPHONY_CUSTOM_LLM_SECRET_ID")
            if missing:
                raise RuntimeError(
                    "Custom telephony LLM is enabled but missing required env vars: "
                    + ", ".join(missing)
                    + ". Create an ElevenLabs Custom LLM secret for the Kimi API key and set its secret_id here."
                )

    def run_outbound_call(
        self,
        *,
        twin: TwinProfile,
        task: DelegationTask,
        prompt: str,
        first_message: str,
    ) -> dict[str, Any]:
        self.validate()
        lang = (twin.language or "tr-TR").split("-")[0]
        voice_model = self._resolve_voice_model_for_language(twin)
        config_response = requests.patch(
            f"https://api.elevenlabs.io/v1/convai/agents/{self.agent_id}",
            headers=self._headers(),
            json={
                "conversation_config": {
                    "tts": {
                        "voice_id": twin.voice_id,
                        "model_id": voice_model,
                        "stability": twin.stability,
                        "similarity_boost": twin.similarity_boost,
                        "speed": twin.speed,
                        "optimize_streaming_latency": 3,
                    },
                    "agent": {
                        "first_message": first_message,
                        "language": lang,
                        "prompt": self._build_prompt_config(prompt=prompt),
                    },
                    "turn": {
                        "turn_eagerness": "eager",
                        "turn_timeout": 2.5,
                        "silence_end_call_timeout": 90.0,
                    },
                }
            },
            timeout=30,
        )
        agent_config = self._decode_or_raise(config_response, "agent configuration")

        call_response = requests.post(
            "https://api.elevenlabs.io/v1/convai/twilio/outbound-call",
            headers=self._headers(),
            json={
                "agent_id": self.agent_id,
                "agent_phone_number_id": self.phone_number_id,
                "to_number": task.counterpart.phone_number,
            },
            timeout=30,
        )
        call_payload = self._decode_or_raise(call_response, "outbound call")
        return {
            "conversation_id": call_payload.get("conversation_id"),
            "call_sid": call_payload.get("callSid"),
            "status": call_payload.get("message"),
                "agent_config_excerpt": {
                    "first_message": agent_config.get("conversation_config", {}).get("agent", {}).get("first_message"),
                    "language": agent_config.get("conversation_config", {}).get("agent", {}).get("language"),
                    "voice_id": agent_config.get("conversation_config", {}).get("tts", {}).get("voice_id"),
                    "model_id": agent_config.get("conversation_config", {}).get("tts", {}).get("model_id"),
                    "llm_mode": self.llm_mode,
                    "llm": self.native_llm if self.llm_mode == "native" else None,
                    "custom_llm_url": self.custom_llm_url if self.llm_mode == "custom" else None,
                    "custom_llm_model_id": self.custom_llm_model_id if self.llm_mode == "custom" else None,
                },
            }

    def _build_prompt_config(self, *, prompt: str) -> dict[str, Any]:
        prompt_config: dict[str, Any] = {
            "prompt": prompt,
            "temperature": self.llm_temperature,
        }
        if self.llm_mode == "custom":
            prompt_config["llm"] = "custom-llm"
            prompt_config["custom_llm"] = {
                "url": self.custom_llm_url,
                "model_id": self.custom_llm_model_id,
                "api_key": {
                    "secret_id": self.custom_llm_secret_id,
                },
                "request_headers": self.custom_llm_headers,
            }
            return prompt_config
        prompt_config["llm"] = self.native_llm
        return prompt_config

    def _read_float_env(self, key: str, default: float) -> float:
        raw = os.environ.get(key, "").strip()
        if not raw:
            return default
        try:
            return float(raw)
        except ValueError as exc:
            raise RuntimeError(f"{key} must be a valid float.") from exc

    def _read_json_env(self, key: str) -> dict[str, str]:
        raw = os.environ.get(key, "").strip()
        if not raw:
            return {}
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise RuntimeError(f"{key} must be valid JSON.") from exc
        if not isinstance(parsed, dict) or not all(isinstance(k, str) and isinstance(v, str) for k, v in parsed.items()):
            raise RuntimeError(f"{key} must be a JSON object with string keys and values.")
        return parsed

    def _headers(self) -> dict[str, str]:
        return {
            "xi-api-key": self.api_key,
            "Content-Type": "application/json",
        }

    def _decode_or_raise(self, response: requests.Response, operation: str) -> dict[str, Any]:
        if response.ok:
            return response.json()
        detail = ""
        try:
            detail = str(response.json())
        except Exception:
            detail = response.text.strip()
        raise RuntimeError(
            f"ElevenLabs/Twilio request failed for {operation}: HTTP {response.status_code}"
            + (f" - {detail}" if detail else "")
        )

    def _resolve_voice_model_for_language(self, twin: TwinProfile) -> str:
        voice_model = twin.voice_model or "eleven_turbo_v2_5"
        lang = (twin.language or "tr-TR").split("-")[0].lower()
        if lang == "en":
            if voice_model == "eleven_turbo_v2":
                return "eleven_turbo_v2"
            if voice_model == "eleven_flash_v2":
                return "eleven_flash_v2"
        return voice_model
