import json
import shutil
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
import delegations_facade
import storage_reader

router = APIRouter(prefix="/delegations", tags=["delegations"])


class CreateDelegationRequest(BaseModel):
    counterpart_name: str
    counterpart_phone: str
    task_type: str = "custom_request"
    channel: str = "voice_call"
    content_subtype: str | None = None
    video_meeting_intent: str | None = None
    video_meeting_setup: str | None = None
    video_generation_mode: str | None = None
    goal: str
    scheduled_for: str | None = None
    context_notes: list[str] = []
    autonomous_actions: list[str] = []
    approval_required: list[str] = []
    forbidden_actions: list[str] = []
    title: str | None = None


class UpdateDelegationRequest(CreateDelegationRequest):
    pass


class CallRunRequest(BaseModel):
    delegation_path: str


def _save_delegation_payload(path: Path, payload: dict) -> None:
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")


def _resolve_created_delegation(result: dict) -> tuple[dict, Path]:
    delegation_id = result.get("delegation_id")
    delegation_path = result.get("delegation_path")
    resolved = None

    if delegation_id:
        resolved = storage_reader.get_delegation(str(delegation_id))

    if not resolved and delegation_path:
        path = Path(str(delegation_path)).resolve()
        if path.exists():
            payload = json.loads(path.read_text(encoding="utf-8"))
            payload["_path"] = str(path)
            resolved = payload

    if not resolved:
        raise HTTPException(status_code=404, detail="Delegation not found")

    return resolved, Path(resolved["_path"]).resolve()


def _store_source_assets(
    *,
    delegation: dict,
    delegation_path: Path,
    video_generation_mode: str | None = None,
    script_text: str | None = None,
    audio: UploadFile | None = None,
) -> dict:
    delegation_dir = delegation_path.parent
    assets_dir = delegation_dir / "source_assets"
    assets_dir.mkdir(parents=True, exist_ok=True)

    metadata = dict(delegation.get("metadata") or {})

    if video_generation_mode:
        metadata["video_generation_mode"] = video_generation_mode

    if script_text is not None and script_text.strip():
        script_path = assets_dir / "provided_script.txt"
        script_path.write_text(script_text.strip(), encoding="utf-8")
        metadata["source_script_path"] = str(script_path)

    if audio is not None:
        suffix = Path(audio.filename or "").suffix.lower()
        if suffix not in {".mp3", ".wav", ".m4a", ".aac"}:
            raise HTTPException(status_code=400, detail="Unsupported audio type")
        audio_path = assets_dir / f"provided_audio{suffix}"
        with audio_path.open("wb") as buffer:
            shutil.copyfileobj(audio.file, buffer)
        metadata["source_audio_path"] = str(audio_path)

    delegation["metadata"] = metadata
    _save_delegation_payload(delegation_path, delegation)
    return metadata


def _artifact_path_for_kind(delegation: dict, artifact_kind: str) -> Path:
    latest = delegation.get("latest_content_run") or {}
    path_map = {
        "script": latest.get("script_path"),
        "audio": latest.get("audio_path"),
        "video": latest.get("video_path"),
        "manifest": latest.get("manifest_path"),
    }
    selected = path_map.get(artifact_kind)
    if not selected:
        raise HTTPException(status_code=404, detail=f"{artifact_kind.title()} artifact not found")
    path = Path(str(selected)).expanduser().resolve()
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail=f"{artifact_kind.title()} artifact not found")
    return path


@router.get("")
def list_delegations():
    return storage_reader.list_delegations()


@router.get("/{delegation_id}")
def get_delegation(delegation_id: str):
    d = storage_reader.get_delegation(delegation_id)
    if not d:
        raise HTTPException(status_code=404, detail="Delegation not found")
    return d


@router.get("/{delegation_id}/artifacts/{artifact_kind}")
def get_delegation_artifact(
    delegation_id: str,
    artifact_kind: str,
    download: bool = Query(default=False),
):
    d = storage_reader.get_delegation(delegation_id)
    if not d:
        raise HTTPException(status_code=404, detail="Delegation not found")
    path = _artifact_path_for_kind(d, artifact_kind)
    return FileResponse(path, filename=path.name if download else None)


@router.post("")
def create_delegation(body: CreateDelegationRequest):
    result = delegations_facade.create_delegation(
        counterpart_name=body.counterpart_name,
        counterpart_phone=body.counterpart_phone,
        task_type=body.task_type,
        channel=body.channel,
        content_subtype=body.content_subtype,
        video_meeting_intent=body.video_meeting_intent,
        video_meeting_setup=body.video_meeting_setup,
        video_generation_mode=body.video_generation_mode,
        goal=body.goal,
        scheduled_for=body.scheduled_for,
        context_notes=body.context_notes,
        autonomous_actions=body.autonomous_actions,
        approval_required=body.approval_required,
        forbidden_actions=body.forbidden_actions,
        title=body.title,
    )
    delegation_path = result.get("delegation_path")
    if delegation_path and not result.get("delegation_id"):
        result["delegation_id"] = Path(str(delegation_path)).resolve().parent.name
    return result


@router.post("/with-assets")
def create_delegation_with_assets(
    counterpart_name: str | None = Form(default=None),
    counterpart_phone: str | None = Form(default=""),
    task_type: str | None = Form(default="custom_request"),
    channel: str | None = Form(default="voice_call"),
    content_subtype: str | None = Form(default=None),
    video_meeting_intent: str | None = Form(default=None),
    video_meeting_setup: str | None = Form(default=None),
    video_generation_mode: str | None = Form(default=None),
    goal: str | None = Form(default=None),
    scheduled_for: str | None = Form(default=None),
    context_notes_json: str | None = Form(default="[]"),
    autonomous_actions_json: str | None = Form(default="[]"),
    approval_required_json: str | None = Form(default="[]"),
    forbidden_actions_json: str | None = Form(default="[]"),
    title: str | None = Form(default=None),
    script_text: str | None = Form(default=None),
    audio: UploadFile | None = File(default=None),
):
    if not counterpart_name or not goal:
        raise HTTPException(status_code=400, detail="Missing required content schedule fields.")

    try:
        context_notes = json.loads(context_notes_json or "[]")
        autonomous_actions = json.loads(autonomous_actions_json or "[]")
        approval_required = json.loads(approval_required_json or "[]")
        forbidden_actions = json.loads(forbidden_actions_json or "[]")
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=400, detail=f"Invalid form payload: {e}")

    if not all(isinstance(value, list) for value in (context_notes, autonomous_actions, approval_required, forbidden_actions)):
        raise HTTPException(status_code=400, detail="Invalid form payload: expected JSON arrays.")

    result = delegations_facade.create_delegation(
        counterpart_name=counterpart_name,
        counterpart_phone=counterpart_phone or "",
        task_type=task_type or "custom_request",
        channel=channel or "voice_call",
        content_subtype=content_subtype,
        video_meeting_intent=video_meeting_intent,
        video_meeting_setup=video_meeting_setup,
        video_generation_mode=video_generation_mode,
        goal=goal,
        scheduled_for=scheduled_for,
        context_notes=context_notes,
        autonomous_actions=autonomous_actions,
        approval_required=approval_required,
        forbidden_actions=forbidden_actions,
        title=title,
    )
    delegation, delegation_path = _resolve_created_delegation(result)
    _store_source_assets(
        delegation=delegation,
        delegation_path=delegation_path,
        video_generation_mode=video_generation_mode,
        script_text=script_text,
        audio=audio,
    )
    if delegation_path and not result.get("delegation_id"):
        result["delegation_id"] = delegation_path.parent.name
    return result


@router.patch("/{delegation_id}")
def update_delegation(delegation_id: str, body: UpdateDelegationRequest):
    return delegations_facade.update_delegation(
        delegation_id=delegation_id,
        counterpart_name=body.counterpart_name,
        counterpart_phone=body.counterpart_phone,
        task_type=body.task_type,
        channel=body.channel,
        content_subtype=body.content_subtype,
        video_meeting_intent=body.video_meeting_intent,
        video_meeting_setup=body.video_meeting_setup,
        video_generation_mode=body.video_generation_mode,
        goal=body.goal,
        scheduled_for=body.scheduled_for,
        context_notes=body.context_notes,
        autonomous_actions=body.autonomous_actions,
        approval_required=body.approval_required,
        forbidden_actions=body.forbidden_actions,
        title=body.title,
    )


@router.post("/{delegation_id}/content-run")
def run_content(delegation_id: str):
    return delegations_facade.run_content(delegation_id=delegation_id)


@router.post("/{delegation_id}/source-assets")
def upload_source_assets(
    delegation_id: str,
    script_text: str | None = Form(default=None),
    video_generation_mode: str | None = Form(default=None),
    audio: UploadFile | None = File(default=None),
):
    d = storage_reader.get_delegation(delegation_id)
    if not d:
        raise HTTPException(status_code=404, detail="Delegation not found")

    delegation_path = Path(d["_path"]).resolve()
    metadata = _store_source_assets(
        delegation=d,
        delegation_path=delegation_path,
        video_generation_mode=video_generation_mode,
        script_text=script_text,
        audio=audio,
    )
    return {
        "ok": True,
        "source_script_path": metadata.get("source_script_path"),
        "source_audio_path": metadata.get("source_audio_path"),
    }


@router.post("/{delegation_id}/call-run")
def run_call(delegation_id: str):
    return delegations_facade.run_call(delegation_id=delegation_id)


@router.post("/{delegation_id}/approve-pre-call")
def approve_pre_call(delegation_id: str):
    return delegations_facade.approve_pre_call(delegation_id=delegation_id)


@router.post("/{delegation_id}/cancel")
def cancel_delegation(delegation_id: str):
    return delegations_facade.cancel_delegation(delegation_id=delegation_id)


@router.delete("/{delegation_id}")
def delete_delegation(delegation_id: str):
    return delegations_facade.delete_delegation(delegation_id=delegation_id)
