from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from env_utils import twin_workspace_api
import storage_reader

router = APIRouter(prefix="/calls", tags=["calls"])


class LogCallRequest(BaseModel):
    delegation_id: str
    status: str
    summary: str
    outcome: str
    next_steps: list[str] = []
    pending_approvals: list[str] = []
    notes: list[str] = []


@router.get("")
def list_calls():
    return storage_reader.list_all_calls()


@router.get("/{call_id}")
def get_call(call_id: str):
    call = storage_reader.get_call(call_id)
    if not call:
        raise HTTPException(status_code=404, detail="Call not found")
    return call


@router.get("/delegation/{delegation_id}")
def calls_for_delegation(delegation_id: str):
    return storage_reader.list_calls_for(delegation_id)


@router.post("/log")
def log_call(body: LogCallRequest):
    d = storage_reader.get_delegation(body.delegation_id)
    if not d:
        raise HTTPException(status_code=404, detail="Delegation not found")
    try:
        result = twin_workspace_api().log_call_for_delegation(
            delegation_path=d["_path"],
            status=body.status,
            summary=body.summary,
            outcome=body.outcome,
            next_steps=body.next_steps,
            pending_approvals=body.pending_approvals,
            notes=body.notes,
        )
        return result
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))
