from __future__ import annotations

import json
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .env import merged_runtime_env


class LiveAvatarClient:
    def __init__(self) -> None:
        env = merged_runtime_env()
        self.api_key = env.get("LIVEAVATAR_API_KEY", "").strip()
        self.avatar_id = env.get("LIVEAVATAR_AVATAR_ID", "").strip()
        self.base_url = env.get("LIVEAVATAR_BASE_URL", "https://api.liveavatar.com").rstrip("/")

    def _api_request(
        self,
        *,
        method: str,
        path: str,
        headers: dict[str, str] | None = None,
        body: dict[str, Any] | None = None,
        timeout: float = 30.0,
    ) -> dict[str, Any]:
        url = f"{self.base_url}{path}"
        encoded: bytes | None = None
        request_headers = {
            "Accept": "application/json",
            "Accept-Language": "en-US,en;q=0.9",
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
        }
        if headers:
            request_headers.update(headers)
        if body is not None:
            encoded = json.dumps(body).encode("utf-8")
            request_headers.setdefault("Content-Type", "application/json")
        request = Request(url, data=encoded, method=method.upper(), headers=request_headers)
        try:
            with urlopen(request, timeout=timeout) as response:
                raw = response.read().decode("utf-8")
        except HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"LiveAvatar API error {exc.code}: {detail or exc.reason}") from exc
        except URLError as exc:
            raise RuntimeError(f"LiveAvatar network error: {exc.reason}") from exc
        if not raw.strip():
            return {}
        try:
            return json.loads(raw)
        except json.JSONDecodeError as exc:
            raise RuntimeError("LiveAvatar returned non-JSON response.") from exc

    def config_status(self) -> dict[str, Any]:
        return {
            "api_key_configured": bool(self.api_key),
            "avatar_id_configured": bool(self.avatar_id),
            "avatar_id": self.avatar_id or None,
        }

    def create_session_plan(self, *, session_id: str, counterpart_name: str) -> dict[str, Any]:
        return {
            "session_id": session_id,
            "counterpart_name": counterpart_name,
            "avatar_id": self.avatar_id or None,
            "status": "planned",
            "note": "Backend should create a LITE session token, then call /v1/sessions/start and pass the avatar token for the custom LiveKit room.",
        }

    def start_lite_session(
        self,
        *,
        session_id: str,
        counterpart_name: str,
        livekit_url: str,
        livekit_room: str,
        avatar_token: str,
    ) -> dict[str, Any]:
        if not self.api_key:
            raise RuntimeError("LIVEAVATAR_API_KEY is not configured.")
        if not self.avatar_id:
            raise RuntimeError("LIVEAVATAR_AVATAR_ID is not configured.")

        token_payload = {
            "mode": "LITE",
            "avatar_id": self.avatar_id,
            "livekit_config": {
                "livekit_url": livekit_url,
                "livekit_room": livekit_room,
                "livekit_client_token": avatar_token,
            },
        }
        token_response = self._api_request(
            method="POST",
            path="/v1/sessions/token",
            headers={"X-API-KEY": self.api_key},
            body=token_payload,
        )
        token_data = token_response.get("data") or {}
        access_token = str(token_data.get("access_token") or token_data.get("session_token") or "")
        if not access_token:
            raise RuntimeError("LiveAvatar token response did not include an access token.")

        start_response = self._api_request(
            method="POST",
            path="/v1/sessions/start",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        started = start_response.get("data") or {}
        started_session_id = str(started.get("session_id") or session_id)

        return {
            "status": "started",
            "requested_avatar_id": self.avatar_id,
            "counterpart_name": counterpart_name,
            "token_request": {
                "mode": "LITE",
                "avatar_id": self.avatar_id,
                "livekit_url": livekit_url,
                "livekit_room": livekit_room,
            },
            "token_response": token_response,
            "start_response": start_response,
            "session_id": started_session_id,
            "livekit_url": started.get("livekit_url"),
            "livekit_client_token": started.get("livekit_client_token"),
            "livekit_agent_token": started.get("livekit_agent_token"),
            "ws_url": started.get("ws_url"),
            "max_session_duration": started.get("max_session_duration"),
        }

    def stop_session(self, *, session_id: str, reason: str = "USER_CLOSED") -> dict[str, Any]:
        if not self.api_key:
            raise RuntimeError("LIVEAVATAR_API_KEY is not configured.")
        return self._api_request(
            method="POST",
            path="/v1/sessions/stop",
            headers={"X-API-KEY": self.api_key},
            body={"session_id": session_id, "reason": reason},
        )

    def keep_alive(self, *, session_id: str) -> dict[str, Any]:
        if not self.api_key:
            raise RuntimeError("LIVEAVATAR_API_KEY is not configured.")
        return self._api_request(
            method="POST",
            path="/v1/sessions/keep-alive",
            headers={"X-API-KEY": self.api_key},
            body={"session_id": session_id},
        )

