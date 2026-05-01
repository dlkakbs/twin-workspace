from fastapi import APIRouter
from pydantic import BaseModel

from env_utils import HERMES_HOME_ENV, read_env_file, settings_key_file_map, twin_workspace_api
from workspace_paths import read_profile_payload

router = APIRouter(prefix="/settings", tags=["settings"])

KEY_FILE_MAP = settings_key_file_map()


def _settings_service():
    return twin_workspace_api()


def _update_profile_voice_id(voice_id: str) -> None:
    try:
        _settings_service().update_profile_voice_id(voice_id)
    except Exception:
        return


class CredentialsUpdate(BaseModel):
    KIMI_API_KEY: str | None = None
    KIMI_BASE_URL: str | None = None
    OPENAI_API_KEY: str | None = None
    OPENAI_BASE_URL: str | None = None
    ELEVENLABS_API_KEY: str | None = None
    ELEVENLABS_VOICE_ID: str | None = None
    ELEVENLABS_AGENT_ID: str | None = None
    ELEVENLABS_PHONE_NUMBER_ID: str | None = None
    LIVEAVATAR_API_KEY: str | None = None
    LIVEAVATAR_AVATAR_ID: str | None = None
    DEEPGRAM_API_KEY: str | None = None
    LIVEKIT_URL: str | None = None
    LIVEKIT_API_KEY: str | None = None
    LIVEKIT_API_SECRET: str | None = None
    TWILIO_ACCOUNT_SID: str | None = None
    TWILIO_AUTH_TOKEN: str | None = None
    TWILIO_PHONE_NUMBER: str | None = None
    HEYGEN_API_KEY: str | None = None
    TWIN_SUMMARY_LANGUAGE: str | None = None


def _read_voice_id_from_profile() -> str:
    data = read_profile_payload() or {}
    return str(data.get("voice_id", "") or "")


@router.get("")
def get_settings():
    merged = read_env_file(HERMES_HOME_ENV)
    return {
        "ELEVENLABS_API_KEY": merged.get("ELEVENLABS_API_KEY", ""),
        "KIMI_API_KEY": merged.get("KIMI_API_KEY", ""),
        "KIMI_BASE_URL": merged.get("KIMI_BASE_URL", "https://api.moonshot.ai/v1"),
        "OPENAI_API_KEY": merged.get("OPENAI_API_KEY", ""),
        "OPENAI_BASE_URL": merged.get("OPENAI_BASE_URL", "https://api.openai.com/v1"),
        "TWIN_PUBLIC_BASE_URL": merged.get("TWIN_PUBLIC_BASE_URL", ""),
        "ELEVENLABS_VOICE_ID": merged.get("ELEVENLABS_VOICE_ID", "") or _read_voice_id_from_profile(),
        "ELEVENLABS_AGENT_ID": merged.get("ELEVENLABS_AGENT_ID", ""),
        "ELEVENLABS_PHONE_NUMBER_ID": merged.get("ELEVENLABS_PHONE_NUMBER_ID", ""),
        "LIVEAVATAR_API_KEY": merged.get("LIVEAVATAR_API_KEY", ""),
        "LIVEAVATAR_AVATAR_ID": merged.get("LIVEAVATAR_AVATAR_ID", ""),
        "DEEPGRAM_API_KEY": merged.get("DEEPGRAM_API_KEY", ""),
        "LIVEKIT_URL": merged.get("LIVEKIT_URL", ""),
        "LIVEKIT_API_KEY": merged.get("LIVEKIT_API_KEY", ""),
        "LIVEKIT_API_SECRET": merged.get("LIVEKIT_API_SECRET", ""),
        "TWILIO_ACCOUNT_SID": merged.get("TWILIO_ACCOUNT_SID", ""),
        "TWILIO_AUTH_TOKEN": merged.get("TWILIO_AUTH_TOKEN", ""),
        "TWILIO_PHONE_NUMBER": merged.get("TWILIO_PHONE_NUMBER", ""),
        "HEYGEN_API_KEY": merged.get("HEYGEN_API_KEY", ""),
        "TWIN_SUMMARY_LANGUAGE": merged.get("TWIN_SUMMARY_LANGUAGE", "en"),
    }


@router.patch("")
def update_settings(body: CredentialsUpdate):
    updates = body.model_dump(exclude_none=True)
    service = _settings_service()
    for key, value in updates.items():
        if value == "":
            continue
        env_file = KEY_FILE_MAP.get(key)
        if env_file:
            service.write_setting(key, value)
        if key == "ELEVENLABS_VOICE_ID":
            _update_profile_voice_id(value)
    return {"ok": True}
