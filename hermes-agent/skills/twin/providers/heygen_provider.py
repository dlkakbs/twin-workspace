from __future__ import annotations

import mimetypes
import time
from pathlib import Path

import requests

from ..config import TwinSettings


class HeyGenAvatarProvider:
    def __init__(self, settings: TwinSettings) -> None:
        if not settings.heygen_api_key:
            raise RuntimeError("Missing HEYGEN_API_KEY")
        self.settings = settings
        self.api_session = requests.Session()
        self.api_session.headers.update({"X-Api-Key": settings.heygen_api_key})
        self.upload_session = requests.Session()
        self.upload_session.headers.update({"X-API-KEY": settings.heygen_api_key})

    def _upload_asset(self, asset_path: Path) -> str:
        mime_type = mimetypes.guess_type(asset_path.name)[0]
        if not mime_type:
            raise ValueError(f"Unsupported asset type for HeyGen upload: {asset_path}")
        response = self.upload_session.post(
            f"{self.settings.heygen_upload_base_url}/v1/asset",
            headers={"Content-Type": mime_type},
            data=asset_path.read_bytes(),
            timeout=180,
        )
        response.raise_for_status()
        payload = response.json()
        for key in ("asset_id", "id"):
            if payload.get(key):
                return payload[key]
        data = payload.get("data")
        if isinstance(data, dict):
            for key in ("asset_id", "id"):
                if data.get(key):
                    return data[key]
        raise RuntimeError(f"Unexpected HeyGen upload response: {payload}")

    def _create_video(self, image_asset_id: str, audio_asset_id: str) -> str:
        response = self.api_session.post(
            f"{self.settings.heygen_api_base_url}/v2/videos",
            headers={"Content-Type": "application/json"},
            json={
                "image_asset_id": image_asset_id,
                "audio_asset_id": audio_asset_id,
            },
            timeout=180,
        )
        response.raise_for_status()
        payload = response.json()
        for key in ("video_id", "id"):
            if payload.get(key):
                return payload[key]
        data = payload.get("data")
        if isinstance(data, dict):
            for key in ("video_id", "id"):
                if data.get(key):
                    return data[key]
        raise RuntimeError(f"Unexpected HeyGen create video response: {payload}")

    def _wait_for_video(self, video_id: str) -> str:
        deadline = time.time() + self.settings.heygen_timeout_seconds
        while time.time() < deadline:
            response = self.api_session.get(
                f"{self.settings.heygen_api_base_url}/v1/video_status.get",
                params={"video_id": video_id},
                timeout=60,
            )
            response.raise_for_status()
            payload = response.json()
            status = (
                payload.get("status")
                or payload.get("data", {}).get("status")
                or payload.get("data", {}).get("video_status")
            )
            if status in {"completed", "success"}:
                data = payload.get("data", {})
                for key in ("video_url", "url", "video_share_url"):
                    if data.get(key):
                        return data[key]
                if payload.get("video_url"):
                    return payload["video_url"]
                raise RuntimeError(f"HeyGen completed without a video URL: {payload}")
            if status in {"failed", "error"}:
                raise RuntimeError(f"HeyGen video failed: {payload}")
            time.sleep(self.settings.heygen_poll_interval_seconds)
        raise TimeoutError(f"HeyGen video {video_id} did not finish in time.")

    def generate_video(self, *, image_path: Path, audio_path: Path, output_path: Path, name: str) -> Path:
        image_asset_id = self._upload_asset(image_path)
        audio_asset_id = self._upload_asset(audio_path)
        video_id = self._create_video(image_asset_id=image_asset_id, audio_asset_id=audio_asset_id)
        video_url = self._wait_for_video(video_id)
        response = requests.get(video_url, timeout=180)
        response.raise_for_status()
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_bytes(response.content)
        return output_path
