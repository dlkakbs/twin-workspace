from __future__ import annotations

from threading import Thread
from typing import Any

from fastapi import HTTPException

from env_utils import twin_workspace_api
import storage_reader
import twin_bridge


def _require_delegation(delegation_id: str) -> dict[str, Any]:
    delegation = storage_reader.get_delegation(delegation_id)
    if not delegation:
        raise HTTPException(status_code=404, detail="Delegation not found")
    return delegation


def _provider_error(exc: RuntimeError) -> HTTPException:
    return HTTPException(status_code=500, detail=twin_bridge._humanize_provider_error(str(exc)))


def create_delegation(**kwargs: Any) -> dict[str, Any]:
    try:
        result = twin_bridge.delegate_create(**kwargs)
        return result
    except RuntimeError as exc:
        raise _provider_error(exc)


def update_delegation(*, delegation_id: str, **kwargs: Any) -> dict[str, Any]:
    delegation = _require_delegation(delegation_id)
    try:
        result = twin_bridge.delegate_update(
            delegation_path=delegation["_path"],
            **kwargs,
        )
        result["delegation_id"] = delegation_id
        return result
    except RuntimeError as exc:
        raise _provider_error(exc)


def run_content(*, delegation_id: str) -> dict[str, Any]:
    delegation = _require_delegation(delegation_id)
    try:
        return twin_bridge.content_run(delegation_path=delegation["_path"])
    except RuntimeError as exc:
        raise _provider_error(exc)


def run_call(*, delegation_id: str) -> dict[str, Any]:
    delegation = _require_delegation(delegation_id)
    try:
        twin_workspace_api().assert_manual_run_allowed(delegation["_path"])
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc))

    try:
        result = twin_bridge.call_run(delegation_path=delegation["_path"])
    except RuntimeError as exc:
        raise _provider_error(exc)

    conversation_id = result.get("conversation_id")
    call_run_path = result.get("call_run_path")
    call_sid = result.get("call_sid")

    if call_sid and call_run_path:
        Thread(
            target=twin_bridge.wait_for_call_connection_and_mark_safe,
            kwargs={
                "call_run_path": call_run_path,
                "call_sid": call_sid,
            },
            daemon=True,
        ).start()

    if conversation_id and call_run_path:
        Thread(
            target=twin_bridge.wait_for_conversation_and_log_safe,
            kwargs={
                "delegation_path": delegation["_path"],
                "call_run_path": call_run_path,
                "conversation_id": conversation_id,
            },
            daemon=True,
        ).start()

    return result


def approve_pre_call(*, delegation_id: str) -> dict[str, Any]:
    delegation = _require_delegation(delegation_id)
    try:
        return twin_workspace_api().approve_pre_call(delegation["_path"])
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc))


def cancel_delegation(*, delegation_id: str) -> dict[str, Any]:
    delegation = _require_delegation(delegation_id)
    try:
        return twin_bridge.cancel_delegation(delegation_path=delegation["_path"])
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc))


def delete_delegation(*, delegation_id: str) -> dict[str, Any]:
    delegation = _require_delegation(delegation_id)
    try:
        return twin_bridge.delete_delegation(delegation_path=delegation["_path"])
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc))
