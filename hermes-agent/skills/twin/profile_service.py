from __future__ import annotations

from pathlib import Path
from typing import Any

from .models import TwinProfile
from .storage import TwinStorage


class TwinProfileService:
    """Canonical profile read/write service for Twin domain data."""

    def __init__(self, storage: TwinStorage) -> None:
        self.storage = storage

    def get_profile(self, profile_slug: str) -> TwinProfile:
        return TwinProfile.from_dict(
            self.storage.read_json(self.storage.profile_json_path(profile_slug))
        )

    def update_profile(self, profile_slug: str, patch: dict[str, Any]) -> TwinProfile:
        current = self.get_profile(profile_slug).to_dict()
        current.update({key: value for key, value in patch.items() if value is not None})
        updated = TwinProfile.from_dict(current)
        self.storage.save_profile(updated)
        return updated

    def update_photo_path(self, profile_slug: str, photo_path: Path) -> TwinProfile:
        return self.update_profile(profile_slug, {"photo_path": str(photo_path)})

