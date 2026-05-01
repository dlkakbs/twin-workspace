from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any

from dotenv import load_dotenv


load_dotenv(Path(__file__).parent / ".env")

DEFAULT_HERMES_ROOT = Path(__file__).resolve().parents[1] / "hermes-agent"
HERMES_ROOT = Path(os.environ.get("HERMES_ROOT", str(DEFAULT_HERMES_ROOT))).expanduser().resolve()


def _workspace_contract():
    if str(HERMES_ROOT) not in sys.path:
        sys.path.insert(0, str(HERMES_ROOT))
    from skills.twin.workspace_contract import TwinWorkspaceContract

    output_root = os.environ.get("HERMES_OUTPUTS") or os.environ.get("TWIN_OUTPUT_ROOT")
    return TwinWorkspaceContract.from_values(
        project_root=HERMES_ROOT,
        output_root=Path(output_root).expanduser().resolve() if output_root else None,
        profile_slug=os.environ.get("TWIN_PROFILE_SLUG"),
    )


WORKSPACE_CONTRACT = _workspace_contract()
HERMES_OUTPUTS = WORKSPACE_CONTRACT.output_root
TWIN_PROFILE_SLUG = WORKSPACE_CONTRACT.profile_slug
PROFILE_JSON = WORKSPACE_CONTRACT.profile_path
VIDEO_SESSIONS_DIR = WORKSPACE_CONTRACT.video_sessions_dir
DELEGATIONS_DIR = HERMES_OUTPUTS / "delegations" / TWIN_PROFILE_SLUG
RUNS_DIR = HERMES_OUTPUTS / "runs" / TWIN_PROFILE_SLUG
PROFILE_ASSETS_DIR = PROFILE_JSON.parent / "assets"


def profile_assets_dir(*, ensure: bool = False) -> Path:
    if ensure:
        PROFILE_ASSETS_DIR.mkdir(parents=True, exist_ok=True)
    return PROFILE_ASSETS_DIR


def read_profile_payload() -> dict[str, Any] | None:
    if not PROFILE_JSON.exists():
        return None
    try:
        return json.loads(PROFILE_JSON.read_text(encoding="utf-8"))
    except Exception:
        return None


def profile_json_path() -> Path:
    return PROFILE_JSON
