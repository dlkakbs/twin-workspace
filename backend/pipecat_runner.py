from __future__ import annotations

from pathlib import Path

from config import HERMES_ROOT
from hermes_imports import ensure_hermes_import_path

ensure_hermes_import_path(HERMES_ROOT)

from skills.twin._runtime.realtime.livekit_plan import build_runner_env
from skills.twin._runtime.realtime.livekit_plan import build_runner_plan as _build_runner_plan


def build_runner_plan(*, session_payload, session_file_path: str):
    worker_path = str(Path(__file__).resolve().parent / "pipecat_worker.py")
    return _build_runner_plan(
        session_payload=session_payload,
        session_file_path=session_file_path,
        worker_path=worker_path,
    )
