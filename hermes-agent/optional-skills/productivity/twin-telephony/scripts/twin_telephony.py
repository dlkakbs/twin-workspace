#!/usr/bin/env python3
from __future__ import annotations
"""User-facing Twin telephony runtime wrapper.

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
        if (root / "skills" / "twin" / "_runtime" / "telephony").exists():
            if str(root) not in sys.path:
                sys.path.insert(0, str(root))
            return

    raise RuntimeError(
        "Could not locate Hermes repo root for twin_telephony runtime imports. "
        "Set HERMES_ROOT to your hermes-agent checkout."
    )


_bootstrap_repo_root()

from skills.twin._runtime.telephony.providers import (
    fetch_conversation,
    fetch_twilio_call,
    fetch_twilio_call_events,
    read_elevenlabs_credentials,
    read_twilio_credentials,
)

HERMES_HOME_ENV = Path.home() / ".hermes" / ".env"


def _env_path(value: str | None) -> Path:
    return Path(value).expanduser().resolve() if value else HERMES_HOME_ENV


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Twin telephony runtime helper.")
    parser.add_argument("--env-path", default=str(HERMES_HOME_ENV))
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("diagnose", help="Show whether Twin telephony credentials are configured.")

    p = subparsers.add_parser("fetch-twilio-call", help="Fetch a Twilio call by SID.")
    p.add_argument("--call-sid", required=True)

    p = subparsers.add_parser("fetch-twilio-events", help="Fetch Twilio call events by call SID.")
    p.add_argument("--call-sid", required=True)

    p = subparsers.add_parser("fetch-conversation", help="Fetch an ElevenLabs conversation by ID.")
    p.add_argument("--conversation-id", required=True)

    return parser


def main() -> int:
    parser = _build_parser()
    args = parser.parse_args()
    env_path = _env_path(args.env_path)

    if args.command == "diagnose":
        twilio_account_sid, twilio_auth_token, twilio_phone_number = read_twilio_credentials(env_path)
        elevenlabs_api_key, elevenlabs_phone_number_id, _ = read_elevenlabs_credentials(env_path)
        print(json.dumps({
            "twilio_account_sid_configured": bool(twilio_account_sid),
            "twilio_auth_token_configured": bool(twilio_auth_token),
            "twilio_phone_number_configured": bool(twilio_phone_number),
            "elevenlabs_api_key_configured": bool(elevenlabs_api_key),
            "elevenlabs_phone_number_id_configured": bool(elevenlabs_phone_number_id),
        }, indent=2, ensure_ascii=False))
        return 0

    if args.command == "fetch-twilio-call":
        print(json.dumps(fetch_twilio_call(env_path=env_path, call_sid=args.call_sid), indent=2, ensure_ascii=False))
        return 0

    if args.command == "fetch-twilio-events":
        print(json.dumps(fetch_twilio_call_events(env_path=env_path, call_sid=args.call_sid), indent=2, ensure_ascii=False))
        return 0

    if args.command == "fetch-conversation":
        print(json.dumps(fetch_conversation(env_path=env_path, conversation_id=args.conversation_id), indent=2, ensure_ascii=False))
        return 0

    parser.error(f"Unknown command: {args.command}")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
