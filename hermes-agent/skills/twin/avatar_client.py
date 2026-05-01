from __future__ import annotations

from pathlib import Path
from typing import Protocol


class AvatarProvider(Protocol):
    def generate_video(self, *, image_path: Path, audio_path: Path, output_path: Path, name: str) -> Path:
        ...
