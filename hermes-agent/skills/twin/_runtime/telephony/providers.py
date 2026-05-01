from __future__ import annotations

from pathlib import Path
from typing import Any
from urllib.parse import urlencode

import requests

from .env import read_env_file


def read_twilio_credentials(env_path: Path) -> tuple[str, str, str]:
    merged = read_env_file(env_path)
    account_sid = merged.get("TWILIO_ACCOUNT_SID", "").strip()
    auth_token = merged.get("TWILIO_AUTH_TOKEN", "").strip()
    phone_number = merged.get("TWILIO_PHONE_NUMBER", "").strip()
    return account_sid, auth_token, phone_number


def read_elevenlabs_credentials(env_path: Path) -> tuple[str, str, str]:
    merged = read_env_file(env_path)
    api_key = merged.get("ELEVENLABS_API_KEY", "").strip()
    phone_number_id = merged.get("ELEVENLABS_PHONE_NUMBER_ID", "").strip()
    phone_number = merged.get("TWILIO_PHONE_NUMBER", "").strip()
    return api_key, phone_number_id, phone_number


def twilio_request(
    *,
    env_path: Path,
    method: str,
    path: str,
    data: dict[str, Any] | None = None,
    params: dict[str, Any] | None = None,
) -> dict[str, Any]:
    account_sid, auth_token, _ = read_twilio_credentials(env_path)
    if not account_sid or not auth_token:
        raise RuntimeError("Twilio Account SID and Auth Token must be configured.")

    url = f"https://api.twilio.com/2010-04-01/Accounts/{account_sid}{path}"
    headers = {
        "Accept": "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
    }
    response = requests.request(
        method=method,
        url=url,
        auth=(account_sid, auth_token),
        headers=headers,
        data=urlencode({k: v for k, v in (data or {}).items() if v not in (None, "")}),
        params=params,
        timeout=30,
    )
    if response.status_code >= 400:
        detail = response.text.strip()
        try:
            payload = response.json()
            detail = payload.get("message") or payload.get("detail") or detail
        except Exception:
            pass
        raise RuntimeError(f"Twilio error: {detail or response.reason}")
    try:
        return response.json()
    except Exception:
        if method.upper() == "DELETE" or not response.text.strip():
            return {}
        raise RuntimeError("Twilio returned a non-JSON response.")


def elevenlabs_request(
    *,
    env_path: Path,
    method: str,
    path: str,
    payload: dict[str, Any] | None = None,
) -> Any:
    api_key, _, _ = read_elevenlabs_credentials(env_path)
    if not api_key:
        raise RuntimeError("ElevenLabs API key must be configured.")

    response = requests.request(
        method=method,
        url=f"https://api.elevenlabs.io{path}",
        headers={
            "Accept": "application/json",
            "Content-Type": "application/json",
            "xi-api-key": api_key,
        },
        json=payload,
        timeout=30,
    )
    if response.status_code >= 400:
        detail = response.text.strip()
        try:
            body = response.json()
            detail = body.get("message") or body.get("detail") or detail
        except Exception:
            pass
        raise RuntimeError(f"ElevenLabs error: {detail or response.reason}")
    try:
        return response.json()
    except Exception:
        if method.upper() == "DELETE" or not response.text.strip():
            return {}
        raise RuntimeError("ElevenLabs returned a non-JSON response.")


def fetch_twilio_call(*, env_path: Path, call_sid: str) -> dict[str, Any]:
    account_sid, auth_token, _ = read_twilio_credentials(env_path)
    if not account_sid or not auth_token:
        raise RuntimeError("TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN are not configured.")
    response = requests.get(
        f"https://api.twilio.com/2010-04-01/Accounts/{account_sid}/Calls/{call_sid}.json",
        auth=(account_sid, auth_token),
        timeout=30,
    )
    response.raise_for_status()
    return response.json()


def fetch_twilio_call_events(*, env_path: Path, call_sid: str) -> list[dict[str, Any]]:
    account_sid, auth_token, _ = read_twilio_credentials(env_path)
    if not account_sid or not auth_token:
        raise RuntimeError("TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN are not configured.")
    response = requests.get(
        f"https://api.twilio.com/2010-04-01/Accounts/{account_sid}/Calls/{call_sid}/Events.json",
        auth=(account_sid, auth_token),
        timeout=30,
    )
    response.raise_for_status()
    payload = response.json()
    return payload.get("events") or []


def fetch_conversation(*, env_path: Path, conversation_id: str) -> dict[str, Any]:
    api_key, _, _ = read_elevenlabs_credentials(env_path)
    if not api_key:
        raise RuntimeError("ELEVENLABS_API_KEY is not configured.")
    response = requests.get(
        f"https://api.elevenlabs.io/v1/convai/conversations/{conversation_id}",
        headers={"xi-api-key": api_key},
        timeout=30,
    )
    response.raise_for_status()
    return response.json()


def send_twilio_sms(*, env_path: Path, to_number: str, body: str) -> dict[str, Any]:
    account_sid, auth_token, from_number = read_twilio_credentials(env_path)
    if not account_sid or not auth_token or not from_number:
        raise RuntimeError("TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_PHONE_NUMBER must be configured.")
    if not str(body).strip():
        raise RuntimeError("SMS body cannot be empty.")

    return twilio_request(
        env_path=env_path,
        method="POST",
        path="/Messages.json",
        data={
            "To": to_number,
            "From": from_number,
            "Body": body.strip(),
        },
    )
