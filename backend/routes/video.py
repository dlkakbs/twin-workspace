from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

import video_session_manager

router = APIRouter(prefix="/video", tags=["video"])


class CreateVideoSessionRequest(BaseModel):
    title: str = Field(..., min_length=3, max_length=160)
    goal: str = Field(..., min_length=3, max_length=4000)
    counterpart_name: str | None = Field(default=None, max_length=160)
    workspace_notes: list[str] = Field(default_factory=list)


@router.get("/sessions")
def list_video_sessions():
    return video_session_manager.list_sessions()


@router.get("/sessions/debug")
def video_debug_snapshot():
    try:
        return video_session_manager.session_debug_snapshot()
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/sessions")
def create_video_session(body: CreateVideoSessionRequest):
    try:
        return video_session_manager.create_session(
            title=body.title,
            goal=body.goal,
            counterpart_name=body.counterpart_name,
            workspace_notes=body.workspace_notes,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/sessions/{video_session_id}")
def get_video_session(video_session_id: str):
    payload = video_session_manager.get_session(video_session_id)
    if not payload:
        raise HTTPException(status_code=404, detail="Video session not found.")
    return payload


@router.post("/sessions/{video_session_id}/start")
def start_video_session(video_session_id: str):
    try:
        return video_session_manager.start_session(video_session_id)
    except RuntimeError as exc:
        if "not found" in str(exc).lower():
            raise HTTPException(status_code=404, detail=str(exc))
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/sessions/{video_session_id}/end")
def end_video_session(video_session_id: str):
    try:
        return video_session_manager.end_session(video_session_id)
    except RuntimeError as exc:
        if "not found" in str(exc).lower():
            raise HTTPException(status_code=404, detail=str(exc))
        raise HTTPException(status_code=400, detail=str(exc))


@router.delete("/sessions/{video_session_id}")
def delete_video_session(video_session_id: str):
    try:
        return video_session_manager.delete_session(video_session_id)
    except RuntimeError as exc:
        if "not found" in str(exc).lower():
            raise HTTPException(status_code=404, detail=str(exc))
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/join/{invite_token}")
def resolve_video_invite(invite_token: str):
    payload = video_session_manager.get_session_by_invite(invite_token)
    if not payload:
        raise HTTPException(status_code=404, detail="Invite not found.")
    return video_session_manager.public_session_view(payload)
