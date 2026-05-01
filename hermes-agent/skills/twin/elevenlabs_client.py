from __future__ import annotations

import mimetypes
from pathlib import Path

import requests

from .config import TwinSettings


class ElevenLabsTwinClient:
    def __init__(self, settings: TwinSettings) -> None:
        self.settings = settings
        self.session = requests.Session()
        self.session.headers.update({"xi-api-key": settings.elevenlabs_api_key})

    def _raise_for_status(self, response: requests.Response, operation: str) -> None:
        if response.ok:
            return
        detail = ""
        try:
            payload = response.json()
            detail = str(payload)
        except Exception:
            detail = response.text.strip()
        raise RuntimeError(
            f"ElevenLabs request failed for {operation}: HTTP {response.status_code}"
            + (f" - {detail}" if detail else "")
        )

    def clone_voice(self, name: str, sample_path: Path) -> str:
        mime_type = mimetypes.guess_type(sample_path.name)[0] or "audio/mpeg"
        with sample_path.open("rb") as sample_file:
            response = self.session.post(
                f"{self.settings.elevenlabs_base_url}/voices/add",
                data={"name": name},
                files=[("files", (sample_path.name, sample_file, mime_type))],
                timeout=180,
            )
        self._raise_for_status(response, "voice clone")
        payload = response.json()
        return payload["voice_id"]

    def text_to_speech(self, voice_id: str, text: str, output_path: Path) -> Path:
        response = self.session.post(
            f"{self.settings.elevenlabs_base_url}/text-to-speech/{voice_id}",
            headers={"Accept": "audio/mpeg", "Content-Type": "application/json"},
            json={
                "text": text,
                "model_id": self.settings.elevenlabs_tts_model,
                "output_format": "mp3_44100_128",
            },
            timeout=180,
        )
        self._raise_for_status(response, "text to speech")
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_bytes(response.content)
        return output_path
