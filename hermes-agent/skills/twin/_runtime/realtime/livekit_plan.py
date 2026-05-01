from __future__ import annotations

import base64
import hashlib
import hmac
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from .env import merged_runtime_env
from .liveavatar import LiveAvatarClient


def build_runner_env() -> dict[str, str]:
    env = merged_runtime_env()
    env.setdefault("PIPECAT_STT_PROVIDER", "deepgram")
    env.setdefault("PIPECAT_LLM_PROVIDER", "kimi")
    env.setdefault("PIPECAT_TTS_PROVIDER", "elevenlabs")
    return env


def _livekit_bundle(session_id: str) -> dict[str, Any] | None:
    env = merged_runtime_env()
    livekit_url = env.get("LIVEKIT_URL", "").strip()
    livekit_api_key = env.get("LIVEKIT_API_KEY", "").strip()
    livekit_api_secret = env.get("LIVEKIT_API_SECRET", "").strip()
    if not (livekit_url and livekit_api_key and livekit_api_secret):
        return None

    room_name = f"twin-video-{session_id}"
    bot_identity = f"twin-bot-{session_id}"
    user_identity = f"guest-{session_id}"
    avatar_identity = f"liveavatar-{session_id}"

    def _b64url(data: bytes) -> str:
        return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")

    def _jwt(identity: str, name: str) -> str:
        now = datetime.now(timezone.utc)
        payload = {
            "sub": identity,
            "iss": livekit_api_key,
            "nbf": int(now.timestamp()),
            "exp": int((now + timedelta(hours=2)).timestamp()),
            "name": name,
            "video": {
                "roomJoin": True,
                "room": room_name,
                "canPublish": True,
                "canSubscribe": True,
                "canPublishData": True,
            },
        }
        header = {"alg": "HS256", "typ": "JWT"}
        signing_input = f"{_b64url(json.dumps(header, separators=(',', ':')).encode())}.{_b64url(json.dumps(payload, separators=(',', ':')).encode())}"
        signature = hmac.new(
            livekit_api_secret.encode("utf-8"),
            signing_input.encode("utf-8"),
            hashlib.sha256,
        ).digest()
        return f"{signing_input}.{_b64url(signature)}"

    return {
        "status": "configured",
        "url": livekit_url,
        "room_name": room_name,
        "bot_identity": bot_identity,
        "bot_token": _jwt(bot_identity, "Twin Bot"),
        "user_identity": user_identity,
        "user_token": _jwt(user_identity, "Guest"),
        "avatar_identity": avatar_identity,
        "avatar_token": _jwt(avatar_identity, "LiveAvatar"),
    }


def build_runner_plan(*, session_payload: dict[str, Any], session_file_path: str, worker_path: str | None = None) -> dict[str, Any]:
    liveavatar = LiveAvatarClient()
    session_id = str(session_payload.get("video_session_id"))
    resolved_worker_path = worker_path or str(Path(__file__).resolve().parent / "pipecat_worker.py")
    livekit = _livekit_bundle(session_id)
    runtime = dict(session_payload.get("runtime", {}))
    runtime.pop("runner_plan", None)
    return {
        "status": "planned",
        "entrypoint": resolved_worker_path,
        "session_id": session_id,
        "command_preview": f"python3 {resolved_worker_path} --session-file {session_file_path} --check-only",
        "providers": runtime,
        "livekit": livekit,
        "liveavatar": liveavatar.create_session_plan(
            session_id=session_id,
            counterpart_name=str(session_payload.get("counterpart_name") or "Guest"),
        ),
        "note": "Worker now has real Pipecat service wiring. Remaining work is connecting this plan to a real LiveAvatar session lifecycle.",
    }

