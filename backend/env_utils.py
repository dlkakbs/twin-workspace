from __future__ import annotations

import os
from pathlib import Path

from workspace_paths import WORKSPACE_CONTRACT


HERMES_HOME_DIR = Path(os.environ.get("HERMES_HOME", str(Path.home() / ".hermes"))).expanduser()
HERMES_HOME_ENV = HERMES_HOME_DIR / ".env"
SETTINGS_ENV_KEYS: tuple[str, ...] = (
    "KIMI_API_KEY",
    "KIMI_BASE_URL",
    "OPENAI_API_KEY",
    "OPENAI_BASE_URL",
    "ELEVENLABS_API_KEY",
    "ELEVENLABS_VOICE_ID",
    "HEYGEN_API_KEY",
    "LIVEAVATAR_API_KEY",
    "LIVEAVATAR_AVATAR_ID",
    "DEEPGRAM_API_KEY",
    "LIVEKIT_URL",
    "LIVEKIT_API_KEY",
    "LIVEKIT_API_SECRET",
    "TWILIO_ACCOUNT_SID",
    "TWILIO_AUTH_TOKEN",
    "TWILIO_PHONE_NUMBER",
    "ELEVENLABS_AGENT_ID",
    "ELEVENLABS_PHONE_NUMBER_ID",
    "TWIN_SUMMARY_LANGUAGE",
)


def read_env_file(path: Path) -> dict[str, str]:
    if not path.exists():
        return {}
    result: dict[str, str] = {}
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        result[key.strip()] = value.strip()
    return result


def merged_runtime_env() -> dict[str, str]:
    env = os.environ.copy()
    for key, value in read_env_file(HERMES_HOME_ENV).items():
        env.setdefault(key, value)
    return env


def settings_key_file_map() -> dict[str, Path]:
    return {key: HERMES_HOME_ENV for key in SETTINGS_ENV_KEYS}


def write_env_key(path: Path, key: str, value: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    lines: list[str] = []
    found = False
    if path.exists():
        for line in path.read_text().splitlines():
            if line.strip().startswith(f"{key}="):
                lines.append(f"{key}={value}")
                found = True
            else:
                lines.append(line)
    if not found:
        lines.append(f"{key}={value}")
    path.write_text("\n".join(lines) + "\n")


def remove_env_key(path: Path, key: str) -> None:
    if not path.exists():
        return
    lines = [
        line
        for line in path.read_text().splitlines()
        if not line.strip().startswith(f"{key}=")
    ]
    path.write_text("\n".join(lines).rstrip() + ("\n" if lines else ""))


def twin_workspace_contract():
    return WORKSPACE_CONTRACT


def twin_workspace_api():
    return twin_workspace_contract().make_workspace_api()


def twin_realtime_workspace_api():
    import storage_reader

    return twin_workspace_contract().make_realtime_workspace_api(
        runtime_env_loader=merged_runtime_env,
        storage_reader_module=storage_reader,
    )
