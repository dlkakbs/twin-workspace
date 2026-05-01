from __future__ import annotations

import json
from typing import Any


def build_browser_join_state(payload: dict[str, Any]) -> dict[str, Any]:
    runtime = payload.get("runtime") or {}
    provider_state = payload.get("provider_state") or {}
    livekit = ((runtime.get("runner_plan") or {}).get("livekit") or {})
    liveavatar_session = runtime.get("liveavatar_session") or {}

    missing: list[str] = []
    if livekit.get("status") != "configured":
        missing.append("livekit_runner_plan")
    if not livekit.get("url"):
        missing.append("livekit_url")
    if not livekit.get("room_name"):
        missing.append("livekit_room_name")
    if not livekit.get("user_token"):
        missing.append("livekit_user_token")
    if provider_state.get("liveavatar") != "started":
        missing.append("liveavatar_session")
    if not liveavatar_session.get("session_id"):
        missing.append("liveavatar_session_id")
    if not liveavatar_session.get("ws_url"):
        missing.append("liveavatar_ws_url")

    session_status = str(payload.get("status") or "")
    runner_status = str(runtime.get("runner_status") or "unknown")
    if session_status == "ended":
        status = "session_ended"
    elif missing:
        status = "backend_bootstrap_pending"
    else:
        status = "browser_join_ready"

    return {
        "status": status,
        "missing": missing,
        "capabilities": {
            "backend_session_model": True,
            "invite_resolution": True,
            "livekit_bootstrap": bool(livekit.get("url") and livekit.get("user_token")),
            "liveavatar_bootstrap": provider_state.get("liveavatar") == "started",
            "browser_media_join": not missing,
        },
        "current_surface": {
            "session_status": session_status,
            "runner_status": runner_status,
            "liveavatar_state": str(provider_state.get("liveavatar") or "unknown"),
            "pipecat_state": str(provider_state.get("pipecat") or "unknown"),
        },
        "artifacts": {
            "livekit_url": livekit.get("url"),
            "livekit_room_name": livekit.get("room_name"),
            "livekit_user_identity": livekit.get("user_identity"),
            "livekit_user_token_present": bool(livekit.get("user_token")),
            "liveavatar_session_id": liveavatar_session.get("session_id"),
            "liveavatar_ws_url": liveavatar_session.get("ws_url"),
        },
        "next_steps": [
            "Verify the full browser join flow against a live LiveAvatar participant and real media devices.",
            "Add stronger reconnect and session-ended handling around the existing backend lifecycle.",
            "Expand the join surface for device selection, multi-participant layout, and operator diagnostics.",
            "Harden autoplay and permission failure UX for browsers with stricter media policies.",
        ],
    }


def build_session_payload(
    *,
    video_session_id: str,
    title: str,
    goal: str,
    counterpart_name: str,
    profile_slug: str,
    profile: dict[str, Any],
    env_status: dict[str, str],
    missing_env: list[str],
    join_url: str,
    compiled_context: dict[str, Any],
    workspace_notes: list[str],
    created_at: str,
) -> dict[str, Any]:
    llm_env_key = "OPENAI_API_KEY" if "OPENAI_API_KEY" in env_status else "KIMI_API_KEY"
    llm_provider = "openai" if llm_env_key == "OPENAI_API_KEY" else "kimi"
    return {
        "video_session_id": video_session_id,
        "title": title,
        "goal": goal,
        "counterpart_name": counterpart_name,
        "profile_slug": profile_slug,
        "profile_name": profile.get("name", "Twin"),
        "status": "ready_for_wiring" if not missing_env else "configuration_pending",
        "provider_state": {
            "liveavatar": "pending",
            "pipecat": "pending",
            "deepgram": env_status["DEEPGRAM_API_KEY"],
            llm_provider: env_status[llm_env_key],
            "elevenlabs": env_status["ELEVENLABS_API_KEY"],
        },
        "required_env": env_status,
        "missing_env": missing_env,
        "join_url": join_url,
        "created_at": created_at,
        "updated_at": created_at,
        "ended_at": None,
        "workspace_notes": list(workspace_notes),
        "compiled_context": compiled_context,
        "runtime": {
            "transport": "pipecat + liveavatar-lite",
            "stt_provider": "deepgram",
            "llm_provider": llm_provider,
            "tts_provider": "elevenlabs",
            "avatar_provider": "heygen-liveavatar",
            "runner_status": "not_started",
        },
        "artifacts": {
            "transcript_path": None,
            "session_log_path": None,
        },
    }


def public_session_view(payload: dict[str, Any]) -> dict[str, Any]:
    public_payload = json.loads(json.dumps(payload))
    runtime = public_payload.get("runtime") or {}

    livekit = ((runtime.get("runner_plan") or {}).get("livekit") or {})
    if livekit:
        runtime.setdefault("runner_plan", {})["livekit"] = {
            "status": livekit.get("status"),
            "url": livekit.get("url"),
            "room_name": livekit.get("room_name"),
            "user_identity": livekit.get("user_identity"),
            "user_token": livekit.get("user_token"),
        }

    liveavatar_session = runtime.get("liveavatar_session") or {}
    if liveavatar_session:
        runtime["liveavatar_session"] = {
            "status": liveavatar_session.get("status"),
            "session_id": liveavatar_session.get("session_id"),
            "ws_url": liveavatar_session.get("ws_url"),
            "max_session_duration": liveavatar_session.get("max_session_duration"),
            "livekit_url": liveavatar_session.get("livekit_url"),
        }

    worker_process = runtime.get("worker_process") or {}
    if worker_process:
        runtime["worker_process"] = {
            "started_at": worker_process.get("started_at"),
            "alive": worker_process.get("alive"),
        }

    public_payload["browser_join"] = build_browser_join_state(public_payload)
    return public_payload


def build_debug_snapshot(
    *,
    profile: dict[str, Any],
    recent_calls: list[dict[str, Any]],
    recent_delegations: list[dict[str, Any]],
) -> dict[str, Any]:
    return {
        "profile": {
            "name": profile.get("name"),
            "language": profile.get("language"),
            "voice_id_present": bool(profile.get("voice_id")),
            "heygen_avatar_id_present": bool(profile.get("heygen_avatar_id")),
        },
        "recent_calls": recent_calls[:3],
        "recent_delegations": recent_delegations[:3],
    }
