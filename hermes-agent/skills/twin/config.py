from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class TwinSettings:
    openai_api_key: str
    elevenlabs_api_key: str
    heygen_api_key: str | None
    avatar_provider: str
    output_root: Path
    heygen_api_base_url: str
    heygen_upload_base_url: str
    heygen_cli_path: str
    openai_base_url: str
    openai_profile_model: str
    openai_generation_model: str
    elevenlabs_base_url: str
    elevenlabs_voice_model: str
    elevenlabs_tts_model: str
    heygen_poll_interval_seconds: float
    heygen_timeout_seconds: int


def load_twin_settings(project_root: Path) -> TwinSettings:
    output_root = Path(os.environ.get("TWIN_OUTPUT_ROOT", project_root / "outputs" / "twin")).resolve()
    return TwinSettings(
        openai_api_key=os.environ["OPENAI_API_KEY"],
        elevenlabs_api_key=os.environ["ELEVENLABS_API_KEY"],
        heygen_api_key=os.environ.get("HEYGEN_API_KEY"),
        avatar_provider=os.environ.get("TWIN_AVATAR_PROVIDER", "heygen").strip().lower(),
        output_root=output_root,
        heygen_api_base_url=os.environ.get("HEYGEN_API_BASE_URL", "https://api.heygen.com"),
        heygen_upload_base_url=os.environ.get("HEYGEN_UPLOAD_BASE_URL", "https://upload.heygen.com"),
        heygen_cli_path=os.environ.get("HEYGEN_CLI_PATH", str(Path.home() / ".local" / "bin" / "heygen")),
        openai_base_url=os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1"),
        openai_profile_model=os.environ.get("TWIN_OPENAI_PROFILE_MODEL", "gpt-4.1-mini"),
        openai_generation_model=os.environ.get("TWIN_OPENAI_GENERATION_MODEL", "gpt-4.1-mini"),
        elevenlabs_base_url=os.environ.get("ELEVENLABS_BASE_URL", "https://api.elevenlabs.io/v1"),
        elevenlabs_voice_model=os.environ.get("TWIN_ELEVENLABS_VOICE_MODEL", "eleven_multilingual_sts_v2"),
        elevenlabs_tts_model=os.environ.get("TWIN_ELEVENLABS_TTS_MODEL", "eleven_multilingual_v2"),
        heygen_poll_interval_seconds=float(os.environ.get("TWIN_HEYGEN_POLL_INTERVAL", "5")),
        heygen_timeout_seconds=int(os.environ.get("TWIN_HEYGEN_TIMEOUT", "300")),
    )
