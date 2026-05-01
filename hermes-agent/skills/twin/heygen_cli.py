from __future__ import annotations

import json
import subprocess
import time
from pathlib import Path

from .config import TwinSettings


class HeyGenCLIClient:
    def __init__(self, settings: TwinSettings) -> None:
        self.settings = settings
        self.binary = settings.heygen_cli_path

    def _run_json(self, *args: str) -> dict:
        result = subprocess.run(
            [self.binary, *args],
            check=False,
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            detail = result.stderr.strip() or result.stdout.strip() or f"exit={result.returncode}"
            raise RuntimeError(f"HeyGen CLI failed for {' '.join(args)}: {detail}")
        stdout = result.stdout.strip()
        if not stdout:
            raise RuntimeError(f"HeyGen CLI returned no JSON for {' '.join(args)}")
        return json.loads(stdout)

    def _run_plain(self, *args: str) -> None:
        result = subprocess.run(
            [self.binary, *args],
            check=False,
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            detail = result.stderr.strip() or result.stdout.strip() or f"exit={result.returncode}"
            raise RuntimeError(f"HeyGen CLI failed for {' '.join(args)}: {detail}")

    @staticmethod
    def _format_video_failure(video: dict) -> str:
        data = video.get("data") or {}
        failure_code = data.get("failure_code")
        failure_message = data.get("failure_message")
        if failure_code or failure_message:
            detail = " | ".join(str(part).strip() for part in (failure_code, failure_message) if part)
            return f"HeyGen video failed: {detail}"
        return f"HeyGen video failed: {video}"

    def upload_asset(self, file_path: Path) -> str:
        payload = self._run_json("asset", "create", "--file", str(file_path))
        return payload["data"]["asset_id"]

    def clone_voice(self, *, name: str, audio_path: Path) -> str:
        asset_id = self.upload_asset(audio_path)
        payload = self._run_json(
            "voice",
            "clone",
            "create",
            "--voice-name",
            name,
            "-d",
            json.dumps({"audio": {"type": "asset_id", "asset_id": asset_id}}),
        )
        clone_id = payload["data"]["voice_clone_id"]
        deadline = time.time() + self.settings.heygen_timeout_seconds
        while time.time() < deadline:
            current = self._run_json("voice", "get", clone_id)
            data = current["data"]
            if data.get("status") == "complete" and data.get("voice_id"):
                return data["voice_id"]
            if data.get("status") in {"failed", "error"}:
                raise RuntimeError(f"HeyGen voice clone failed: {current}")
            time.sleep(self.settings.heygen_poll_interval_seconds)
        raise TimeoutError("HeyGen voice clone did not finish in time.")

    def create_photo_avatar(self, *, name: str, image_path: Path) -> tuple[str, str]:
        asset_id = self.upload_asset(image_path)
        payload = self._run_json(
            "avatar",
            "create",
            "-d",
            json.dumps(
                {
                    "type": "photo",
                    "name": name,
                    "file": {"type": "asset_id", "asset_id": asset_id},
                }
            ),
        )
        group_id = payload["data"]["avatar_group"]["id"]
        avatar_id = payload["data"]["avatar_item"]["id"]
        deadline = time.time() + self.settings.heygen_timeout_seconds
        while time.time() < deadline:
            current = self._run_json("avatar", "looks", "get", avatar_id)
            data = current["data"]
            if data.get("status") == "completed":
                return group_id, avatar_id
            if data.get("status") in {"failed", "error"}:
                raise RuntimeError(f"HeyGen avatar creation failed: {current}")
            time.sleep(self.settings.heygen_poll_interval_seconds)
        raise TimeoutError("HeyGen avatar did not finish in time.")

    def get_avatar_look(self, avatar_id: str) -> dict:
        payload = self._run_json("avatar", "looks", "get", avatar_id)
        data = payload.get("data") or {}
        return {
            "status": data.get("status"),
            "preview_image_url": data.get("preview_image_url"),
            "avatar_id": data.get("id") or avatar_id,
            "group_id": data.get("group_id"),
            "raw": payload,
        }

    def generate_video(
        self,
        *,
        prompt: str,
        avatar_id: str,
        voice_id: str,
        orientation: str,
        output_path: Path,
    ) -> Path:
        created = self._run_json(
            "video-agent",
            "create",
            "--prompt",
            prompt,
            "--avatar-id",
            avatar_id,
            "--voice-id",
            voice_id,
            "--orientation",
            orientation,
        )
        session_id = created["data"]["session_id"]
        video_id = created["data"]["video_id"]
        approved = False
        deadline = time.time() + self.settings.heygen_timeout_seconds
        while time.time() < deadline:
            session = self._run_json("video-agent", "get", session_id)
            status = session["data"].get("status")
            if status == "waiting_for_input" and not approved:
                self._run_json(
                    "video-agent",
                    "send",
                    session_id,
                    "--message",
                    "Looks good. Proceed and generate the video exactly as planned.",
                )
                approved = True

            video = self._run_json("video", "get", video_id)
            video_data = video["data"]
            video_status = video_data.get("status")
            if video_status == "completed":
                output_path.parent.mkdir(parents=True, exist_ok=True)
                self._run_plain("video", "download", video_id, "--output-path", str(output_path), "--force")
                return output_path
            if video_status in {"failed", "error"}:
                raise RuntimeError(self._format_video_failure(video))
            time.sleep(self.settings.heygen_poll_interval_seconds)
        raise TimeoutError(f"HeyGen video {video_id} did not finish in time.")

    def generate_video_from_audio(
        self,
        *,
        avatar_id: str,
        audio_path: Path,
        orientation: str,
        output_path: Path,
        title: str | None = None,
    ) -> Path:
        audio_asset_id = self.upload_asset(audio_path)
        aspect_ratio = "9:16" if orientation == "portrait" else "16:9"
        payload = {
            "type": "avatar",
            "avatar_id": avatar_id,
            "audio_asset_id": audio_asset_id,
            "aspect_ratio": aspect_ratio,
            "output_format": "mp4",
        }
        if title:
            payload["title"] = title

        created = self._run_json(
            "video",
            "create",
            "-d",
            json.dumps(payload),
        )
        data = created.get("data") or created
        video_id = data.get("video_id") or data.get("id")
        if not video_id:
            raise RuntimeError(f"HeyGen video create returned no video id: {created}")
        deadline = time.time() + self.settings.heygen_timeout_seconds
        while time.time() < deadline:
            video = self._run_json("video", "get", str(video_id))
            video_data = video.get("data") or {}
            video_status = video_data.get("status")
            if video_status == "completed":
                output_path.parent.mkdir(parents=True, exist_ok=True)
                self._run_plain("video", "download", str(video_id), "--output-path", str(output_path), "--force")
                return output_path
            if video_status in {"failed", "error"}:
                raise RuntimeError(self._format_video_failure(video))
            time.sleep(self.settings.heygen_poll_interval_seconds)
        raise TimeoutError(f"HeyGen video {video_id} did not finish in time.")
