from __future__ import annotations

from typing import Any
from urllib.parse import urlencode

import requests
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from config import HERMES_ROOT
from env_utils import HERMES_HOME_ENV, remove_env_key, write_env_key
from hermes_imports import ensure_hermes_import_path

ensure_hermes_import_path(HERMES_ROOT)

from skills.twin._runtime.telephony.providers import elevenlabs_request as runtime_elevenlabs_request
from skills.twin._runtime.telephony.providers import read_elevenlabs_credentials as runtime_read_elevenlabs_credentials
from skills.twin._runtime.telephony.providers import read_twilio_credentials as runtime_read_twilio_credentials
from skills.twin._runtime.telephony.providers import twilio_request as runtime_twilio_request

router = APIRouter(prefix="/twilio", tags=["twilio"])


def _read_twilio_credentials() -> tuple[str, str, str]:
    return runtime_read_twilio_credentials(HERMES_HOME_ENV)


def _read_elevenlabs_credentials() -> tuple[str, str, str]:
    return runtime_read_elevenlabs_credentials(HERMES_HOME_ENV)


def _twilio_request(
    method: str,
    path: str,
    *,
    data: dict[str, Any] | None = None,
    params: dict[str, Any] | None = None,
) -> dict[str, Any]:
    try:
        return runtime_twilio_request(
            env_path=HERMES_HOME_ENV,
            method=method,
            path=path,
            data=data,
            params=params,
        )
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail=f"Twilio request failed: {exc}") from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def _elevenlabs_request(
    method: str,
    path: str,
    *,
    payload: dict[str, Any] | None = None,
) -> Any:
    try:
        return runtime_elevenlabs_request(
            env_path=HERMES_HOME_ENV,
            method=method,
            path=path,
            payload=payload,
        )
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail=f"ElevenLabs request failed: {exc}") from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


class CreateVerificationRequest(BaseModel):
    phone_number: str = Field(..., min_length=3)
    friendly_name: str | None = Field(default=None, max_length=64)
    call_delay: int | None = Field(default=None, ge=0, le=60)
    extension: str | None = None


class ActivateOutboundLineRequest(BaseModel):
    phone_number_id: str = Field(..., min_length=3)


class ImportOutboundLineRequest(BaseModel):
    phone_number: str = Field(..., min_length=3)
    label: str | None = Field(default=None, max_length=128)


class DeleteOutboundLineRequest(BaseModel):
    phone_number_id: str = Field(..., min_length=3)


class DeleteVerifiedNumberRequest(BaseModel):
    sid: str = Field(..., min_length=3)


@router.get("/verified-numbers")
def list_verified_numbers():
    payload = _twilio_request("GET", "/OutgoingCallerIds.json")
    _, _, configured_phone_number = _read_twilio_credentials()
    caller_ids = payload.get("outgoing_caller_ids") or []
    return {
        "configured_phone_number": configured_phone_number,
        "verified_numbers": [
            {
                "sid": item.get("sid"),
                "friendly_name": item.get("friendly_name"),
                "phone_number": item.get("phone_number"),
                "date_created": item.get("date_created"),
            }
            for item in caller_ids
        ],
    }


@router.get("/outbound-lines")
def list_outbound_lines():
    _, configured_phone_number_id, configured_phone_number = _read_elevenlabs_credentials()
    payload = _elevenlabs_request("GET", "/v1/convai/phone-numbers")
    lines = payload if isinstance(payload, list) else []
    return {
        "configured_phone_number_id": configured_phone_number_id,
        "configured_phone_number": configured_phone_number,
        "outbound_lines": [
            {
                "phone_number": item.get("phone_number"),
                "label": item.get("label"),
                "supports_inbound": bool(item.get("supports_inbound")),
                "supports_outbound": bool(item.get("supports_outbound")),
                "phone_number_id": item.get("phone_number_id"),
                "provider": item.get("provider"),
            }
            for item in lines
            if item.get("provider") == "twilio"
        ],
    }


@router.post("/outbound-lines/import")
def import_outbound_line(body: ImportOutboundLineRequest):
    account_sid, auth_token, _ = _read_twilio_credentials()
    if not account_sid or not auth_token:
        raise HTTPException(
            status_code=400,
            detail="Twilio Account SID and Auth Token must be configured in Identity before importing outbound lines.",
        )

    payload = _elevenlabs_request(
        "POST",
        "/v1/convai/phone-numbers",
        payload={
            "provider": "twilio",
            "label": body.label or body.phone_number,
            "phone_number": body.phone_number,
            "sid": account_sid,
            "token": auth_token,
        },
    )
    phone_number_id = payload.get("phone_number_id")
    if not phone_number_id:
        raise HTTPException(status_code=502, detail="ElevenLabs did not return a phone_number_id.")
    details = _elevenlabs_request("GET", f"/v1/convai/phone-numbers/{phone_number_id}")
    return {
        "phone_number": details.get("phone_number"),
        "label": details.get("label"),
        "supports_inbound": bool(details.get("supports_inbound")),
        "supports_outbound": bool(details.get("supports_outbound")),
        "phone_number_id": details.get("phone_number_id"),
        "provider": details.get("provider"),
    }


@router.post("/outbound-lines/activate")
def activate_outbound_line(body: ActivateOutboundLineRequest):
    details = _elevenlabs_request("GET", f"/v1/convai/phone-numbers/{body.phone_number_id}")
    phone_number = (details.get("phone_number") or "").strip()
    phone_number_id = (details.get("phone_number_id") or "").strip()
    if not phone_number or not phone_number_id:
        raise HTTPException(status_code=502, detail="Selected outbound line is missing phone metadata.")

    write_env_key(HERMES_HOME_ENV, "ELEVENLABS_PHONE_NUMBER_ID", phone_number_id)
    write_env_key(HERMES_HOME_ENV, "TWILIO_PHONE_NUMBER", phone_number)
    return {
        "ok": True,
        "phone_number": phone_number,
        "phone_number_id": phone_number_id,
        "supports_inbound": bool(details.get("supports_inbound")),
        "supports_outbound": bool(details.get("supports_outbound")),
        "label": details.get("label"),
    }


@router.delete("/outbound-lines")
def delete_outbound_line(body: DeleteOutboundLineRequest):
    details = _elevenlabs_request("GET", f"/v1/convai/phone-numbers/{body.phone_number_id}")
    phone_number = (details.get("phone_number") or "").strip()
    phone_number_id = (details.get("phone_number_id") or "").strip()
    if not phone_number_id:
        raise HTTPException(status_code=502, detail="Selected outbound line is missing a phone_number_id.")

    _, current_phone_number_id, current_phone_number = _read_elevenlabs_credentials()
    _elevenlabs_request("DELETE", f"/v1/convai/phone-numbers/{phone_number_id}")

    if current_phone_number_id == phone_number_id:
        remove_env_key(HERMES_HOME_ENV, "ELEVENLABS_PHONE_NUMBER_ID")
        if current_phone_number == phone_number:
            remove_env_key(HERMES_HOME_ENV, "TWILIO_PHONE_NUMBER")

    return {
        "ok": True,
        "phone_number": phone_number,
        "phone_number_id": phone_number_id,
        "label": details.get("label"),
        "supports_inbound": bool(details.get("supports_inbound")),
        "supports_outbound": bool(details.get("supports_outbound")),
    }


@router.post("/verified-numbers")
def create_verified_number_request(body: CreateVerificationRequest):
    payload = _twilio_request(
        "POST",
        "/OutgoingCallerIds.json",
        data={
            "PhoneNumber": body.phone_number,
            "FriendlyName": body.friendly_name,
            "CallDelay": body.call_delay,
            "Extension": body.extension,
        },
    )
    return {
        "phone_number": payload.get("phone_number"),
        "friendly_name": payload.get("friendly_name"),
        "validation_code": payload.get("validation_code"),
        "call_sid": payload.get("call_sid"),
    }


@router.delete("/verified-numbers")
def delete_verified_number(body: DeleteVerifiedNumberRequest):
    payload = _twilio_request("GET", f"/OutgoingCallerIds/{body.sid}.json")
    sid = (payload.get("sid") or body.sid).strip()
    phone_number = (payload.get("phone_number") or "").strip()
    if not sid:
        raise HTTPException(status_code=502, detail="Selected verified number is missing a SID.")

    _, _, current_phone_number = _read_twilio_credentials()
    _twilio_request("DELETE", f"/OutgoingCallerIds/{sid}.json")

    if current_phone_number and phone_number and current_phone_number == phone_number:
        remove_env_key(HERMES_HOME_ENV, "TWILIO_PHONE_NUMBER")

    return {
        "ok": True,
        "sid": sid,
        "phone_number": phone_number,
        "friendly_name": payload.get("friendly_name"),
    }
