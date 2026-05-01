from __future__ import annotations

from pathlib import Path

from .profile_service import TwinProfileService


class TwinSettingsService:
    """Canonical env-backed settings service for Twin runtime configuration."""

    def __init__(self, *, env_path: Path, profile_service: TwinProfileService, profile_slug: str) -> None:
        self.env_path = env_path
        self.profile_service = profile_service
        self.profile_slug = profile_slug

    def read_env(self) -> dict[str, str]:
        if not self.env_path.exists():
            return {}
        result: dict[str, str] = {}
        for line in self.env_path.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            result[key.strip()] = value.strip()
        return result

    def write_key(self, key: str, value: str) -> None:
        self.env_path.parent.mkdir(parents=True, exist_ok=True)
        lines: list[str] = []
        found = False
        if self.env_path.exists():
            for line in self.env_path.read_text().splitlines():
                if line.strip().startswith(f"{key}="):
                    lines.append(f"{key}={value}")
                    found = True
                else:
                    lines.append(line)
        if not found:
            lines.append(f"{key}={value}")
        self.env_path.write_text("\n".join(lines) + "\n")

    def remove_key(self, key: str) -> None:
        if not self.env_path.exists():
            return
        lines = [
            line
            for line in self.env_path.read_text().splitlines()
            if not line.strip().startswith(f"{key}=")
        ]
        self.env_path.write_text("\n".join(lines).rstrip() + ("\n" if lines else ""))

    def update_profile_voice_id(self, voice_id: str) -> None:
        self.profile_service.update_profile(self.profile_slug, {"voice_id": voice_id})

