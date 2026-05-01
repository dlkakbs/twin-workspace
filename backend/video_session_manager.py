from __future__ import annotations

from typing import Any

from env_utils import twin_realtime_workspace_api


def _api():
    return twin_realtime_workspace_api()


def list_sessions() -> list[dict[str, Any]]:
    return _api().list_sessions()


def get_session(video_session_id: str) -> dict[str, Any] | None:
    return _api().get_session(video_session_id)


def get_session_by_invite(invite_token: str) -> dict[str, Any] | None:
    return _api().get_session_by_invite(invite_token)


def public_session_view(payload: dict[str, Any]) -> dict[str, Any]:
    return _api().public_session_view(payload)


def create_session(
    *,
    title: str,
    goal: str,
    counterpart_name: str | None = None,
    workspace_notes: list[str] | None = None,
) -> dict[str, Any]:
    return _api().create_session(
        title=title,
        goal=goal,
        counterpart_name=counterpart_name,
        workspace_notes=workspace_notes,
    )


def start_session(video_session_id: str) -> dict[str, Any]:
    return _api().start_session(video_session_id)


def end_session(video_session_id: str) -> dict[str, Any]:
    return _api().end_session(video_session_id)


def delete_session(video_session_id: str) -> dict[str, Any]:
    return _api().delete_session(video_session_id)


def session_debug_snapshot() -> dict[str, Any]:
    return _api().session_debug_snapshot()
