from __future__ import annotations

import json
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .models import TwinProfile


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.strip().lower())
    return slug.strip("-") or "twin"


def utc_timestamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")


class TwinStorage:
    def __init__(self, output_root: Path) -> None:
        self.output_root = output_root
        self.profiles_root = self.output_root / "profiles"
        self.runs_root = self.output_root / "runs"
        self.delegations_root = self.output_root / "delegations"

    def ensure(self) -> None:
        self.profiles_root.mkdir(parents=True, exist_ok=True)
        self.runs_root.mkdir(parents=True, exist_ok=True)
        self.delegations_root.mkdir(parents=True, exist_ok=True)

    def profile_dir(self, slug: str) -> Path:
        return self.profiles_root / slug

    def profile_assets_dir(self, slug: str) -> Path:
        return self.profile_dir(slug) / "assets"

    def profile_json_path(self, slug: str) -> Path:
        return self.profile_dir(slug) / "profile.json"

    def run_dir(self, slug: str, run_id: str) -> Path:
        return self.runs_root / slug / run_id

    def delegation_dir(self, slug: str, delegation_id: str) -> Path:
        return self.delegations_root / slug / delegation_id

    def delegation_json_path(self, slug: str, delegation_id: str) -> Path:
        return self.delegation_dir(slug, delegation_id) / "delegation.json"

    def delegation_calls_dir(self, slug: str, delegation_id: str) -> Path:
        return self.delegation_dir(slug, delegation_id) / "calls"

    def write_json(self, path: Path, payload: dict[str, Any]) -> Path:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
        return path

    def read_json(self, path: Path) -> dict[str, Any]:
        return json.loads(Path(path).read_text(encoding="utf-8"))

    def copy_asset(self, src: Path, dest_dir: Path) -> Path:
        dest_dir.mkdir(parents=True, exist_ok=True)
        dest = dest_dir / src.name
        if src.resolve() != dest.resolve():
            shutil.copy2(src, dest)
        return dest

    def save_profile(self, profile: TwinProfile) -> Path:
        return self.write_json(self.profile_json_path(profile.slug), profile.to_dict())
