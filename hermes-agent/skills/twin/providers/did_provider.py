from __future__ import annotations

import mimetypes
import time
from pathlib import Path

import requests

from ..config import TwinSettings


class DIDAvatarProvider:
    def __init__(self, settings: TwinSettings) -> None:
        if not settings.did_api_key:
            raise RuntimeError("Missing DID_API_KEY")
        self.settings = settings
        self.session = requests.Session()
        self.session.headers.update({"Authorization": f"Basic {settings.did_api_key}"})

    def _upload_image(self, image_path: Path) -> str:
        mime_type = mimetypes.guess_type(image_path.name)[0] or "image/jpeg"
        with image_path.open("rb") as image_file:
            response = self.session.post(
                f"{self.settings.did_base_url}/images",
                files={"image": (image_path.name, image_file, mime_type)},
                timeout=120,
            )
        response.raise_for_status()
        payload = response.json()
        return payload.get("url") or payload.get("image_url") or payload.get("source_url")

    def _upload_audio(self, audio_path: Path) -> str:
        mime_type = mimetypes.guess_type(audio_path.name)[0] or "audio/mpeg"
        with audio_path.open("rb") as audio_file:
            response = self.session.post(
                f"{self.settings.did_base_url}/audios",
                files={"audio": (audio_path.name, audio_file, mime_type)},
                timeout=120,
            )
        response.raise_for_status()
        payload = response.json()
        return payload.get("url") or payload.get("audio_url") or payload.get("source_url")

    def _create_talk(self, image_url: str, audio_url: str, name: str) -> str:
        response = self.session.post(
            f"{self.settings.did_base_url}/talks",
            headers={"Content-Type": "application/json", "Accept": "application/json"},
            json={
                "source_url": image_url,
                "script": {
                    "type": "audio",
                    "audio_url": audio_url,
                },
                "config": {
                    "fluent": True,
                    "pad_audio": 0,
                    "stitch": True,
                    "result_format": "mp4",
                },
                "name": name,
            },
            timeout=120,
        )
        response.raise_for_status()
        payload = response.json()
        return payload["id"]

    def _wait_for_result(self, talk_id: str) -> str:
        deadline = time.time() + self.settings.did_timeout_seconds
        while time.time() < deadline:
            response = self.session.get(
                f"{self.settings.did_base_url}/talks/{talk_id}",
                headers={"Accept": "application/json"},
                timeout=60,
            )
            response.raise_for_status()
            payload = response.json()
            status = payload.get("status")
            if status == "done" and payload.get("result_url"):
                return payload["result_url"]
            if status in {"error", "rejected", "failed"}:
                raise RuntimeError(f"D-ID talk failed: {payload}")
            time.sleep(self.settings.did_poll_interval_seconds)
        raise TimeoutError(f"D-ID talk {talk_id} did not finish in time.")

    def generate_video(self, *, image_path: Path, audio_path: Path, output_path: Path, name: str) -> Path:
        image_url = self._upload_image(image_path)
        audio_url = self._upload_audio(audio_path)
        talk_id = self._create_talk(image_url=image_url, audio_url=audio_url, name=name)
        result_url = self._wait_for_result(talk_id)
        response = self.session.get(result_url, timeout=180)
        response.raise_for_status()
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_bytes(response.content)
        return output_path
