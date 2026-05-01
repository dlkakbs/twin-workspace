from __future__ import annotations

from pathlib import Path

from skills.twin.settings_service import TwinSettingsService


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


def write_key(path: Path, key: str, value: str) -> None:
    service = TwinSettingsService.__new__(TwinSettingsService)
    service.env_path = path
    TwinSettingsService.write_key(service, key, value)


def remove_key(path: Path, key: str) -> None:
    service = TwinSettingsService.__new__(TwinSettingsService)
    service.env_path = path
    TwinSettingsService.remove_key(service, key)

