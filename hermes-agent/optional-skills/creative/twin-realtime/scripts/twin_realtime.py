#!/usr/bin/env python3
from __future__ import annotations
"""User-facing Twin realtime runtime wrapper.

This script is an optional execution surface. Canonical Twin state and
workspace/domain ownership remain in `skills.twin`.
"""

import argparse
import json
import os
from pathlib import Path
import sys


def _bootstrap_repo_root() -> None:
    candidates: list[Path] = []
    configured = os.environ.get("HERMES_ROOT", "").strip()
    if configured:
        candidates.append(Path(configured).expanduser())
    current = Path(__file__).resolve()
    candidates.extend(current.parents)
    candidates.append(Path.cwd())

    for candidate in candidates:
        root = candidate.resolve()
        if (root / "skills" / "twin" / "_runtime" / "realtime").exists():
            if str(root) not in sys.path:
                sys.path.insert(0, str(root))
            return

    raise RuntimeError(
        "Could not locate Hermes repo root for twin_realtime runtime imports. "
        "Set HERMES_ROOT to your hermes-agent checkout."
    )


_bootstrap_repo_root()

from skills.twin._runtime.realtime.liveavatar import LiveAvatarClient
from skills.twin._runtime.realtime.livekit_plan import build_runner_plan


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Twin realtime runtime helper.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("diagnose", help="Show realtime runtime configuration status.")

    p = subparsers.add_parser("build-runner-plan", help="Build a runner plan from a session payload JSON file.")
    p.add_argument("--session-file", required=True)
    p.add_argument("--worker-path")

    p = subparsers.add_parser("start-liveavatar-session", help="Start a LiveAvatar LITE session.")
    p.add_argument("--session-id", required=True)
    p.add_argument("--counterpart-name", required=True)
    p.add_argument("--livekit-url", required=True)
    p.add_argument("--livekit-room", required=True)
    p.add_argument("--avatar-token", required=True)

    p = subparsers.add_parser("stop-liveavatar-session", help="Stop a LiveAvatar session.")
    p.add_argument("--session-id", required=True)
    p.add_argument("--reason", default="USER_CLOSED")

    return parser


def main() -> int:
    parser = _build_parser()
    args = parser.parse_args()
    client = LiveAvatarClient()

    if args.command == "diagnose":
        print(json.dumps(client.config_status(), indent=2, ensure_ascii=False))
        return 0

    if args.command == "build-runner-plan":
        session_file = Path(args.session_file).expanduser().resolve()
        payload = json.loads(session_file.read_text(encoding="utf-8"))
        result = build_runner_plan(
            session_payload=payload,
            session_file_path=str(session_file),
            worker_path=args.worker_path,
        )
        print(json.dumps(result, indent=2, ensure_ascii=False))
        return 0

    if args.command == "start-liveavatar-session":
        result = client.start_lite_session(
            session_id=args.session_id,
            counterpart_name=args.counterpart_name,
            livekit_url=args.livekit_url,
            livekit_room=args.livekit_room,
            avatar_token=args.avatar_token,
        )
        print(json.dumps(result, indent=2, ensure_ascii=False))
        return 0

    if args.command == "stop-liveavatar-session":
        result = client.stop_session(session_id=args.session_id, reason=args.reason)
        print(json.dumps(result, indent=2, ensure_ascii=False))
        return 0

    parser.error(f"Unknown command: {args.command}")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
