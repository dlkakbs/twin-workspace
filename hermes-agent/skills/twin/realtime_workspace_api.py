from __future__ import annotations

import hashlib
import json
import os
import secrets
import signal
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from . import realtime_domain
from .realtime_runtime import TwinRealtimeRuntimeCoordinator
from skills.twin._runtime.realtime.liveavatar import LiveAvatarClient
from skills.twin._runtime.realtime.livekit_plan import build_runner_plan


class TwinRealtimeWorkspaceAPI:
    """Stable facade for workspace-facing realtime session management."""

    def __init__(
        self,
        *,
        project_root: Path,
        profile_path: Path,
        profile_slug: str,
        video_sessions_dir: Path,
        runtime_env_loader: Callable[[], dict[str, str]],
        storage_reader_module: Any,
    ) -> None:
        self.project_root = Path(project_root).expanduser().resolve()
        self.profile_path = Path(profile_path).expanduser().resolve()
        self.profile_slug = profile_slug
        self.video_sessions_dir = Path(video_sessions_dir).expanduser().resolve()
        self.runtime_env_loader = runtime_env_loader
        self.storage_reader = storage_reader_module

    def utc_now_iso(self) -> str:
        return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")

    def session_id(self) -> str:
        return datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")

    def _safe_read_json(self, path: Path) -> dict[str, Any] | None:
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return None

    def _profile_payload(self) -> dict[str, Any]:
        if not self.profile_path.exists():
            raise RuntimeError("Twin profile not found. Run skills.twin setup first.")
        payload = self._safe_read_json(self.profile_path)
        if not payload:
            raise RuntimeError("Twin profile could not be read.")
        return payload

    def _load_realtime_context(self, profile: dict[str, Any]) -> dict[str, Any]:
        try:
            from .realtime_context import build_realtime_context
        except Exception:
            return {
                "prompt": profile.get("persona", ""),
                "workspace_notes": [],
                "recent_calls": [],
                "recent_delegations": [],
            }
        return build_realtime_context(
            profile_slug=self.profile_slug,
            profile_path=self.profile_path,
        )

    def _session_path(self, video_session_id: str) -> Path:
        self.video_sessions_dir.mkdir(parents=True, exist_ok=True)
        return self.video_sessions_dir / f"{video_session_id}.json"

    def _session_log_path(self, video_session_id: str) -> Path:
        self.video_sessions_dir.mkdir(parents=True, exist_ok=True)
        return self.video_sessions_dir / f"{video_session_id}.log"

    def _hermes_python_path(self) -> str:
        configured = os.environ.get("HERMES_PYTHON", "").strip()
        if configured:
            candidate = Path(configured).expanduser()
            if candidate.exists():
                return str(candidate)
            raise RuntimeError(f"HERMES_PYTHON is configured but does not exist: {candidate}")
        for relative in ("bin/python", "bin/python3"):
            candidate = self.project_root / ".venv" / relative
            if candidate.exists():
                return str(candidate)
        raise RuntimeError(
            "Hermes runtime interpreter not found. Set HERMES_PYTHON or create "
            f"{self.project_root / '.venv'} before starting realtime sessions."
        )

    def _write_session(self, path: Path, payload: dict[str, Any]) -> None:
        path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")

    def _pid_is_alive(self, pid: int) -> bool:
        try:
            waited_pid, _status = os.waitpid(pid, os.WNOHANG)
            if waited_pid == pid:
                return False
        except ChildProcessError:
            pass
        except OSError:
            return False
        try:
            os.kill(pid, 0)
            return True
        except OSError:
            return False

    def _terminate_process(self, pid: int) -> None:
        try:
            os.kill(pid, signal.SIGTERM)
        except OSError:
            return
        for _ in range(10):
            if not self._pid_is_alive(pid):
                return
            time.sleep(0.1)

    def _spawn_worker(self, *, session_payload: dict[str, Any], session_file_path: Path) -> dict[str, Any]:
        worker_python = self._hermes_python_path()
        log_path = self._session_log_path(str(session_payload["video_session_id"]))
        command = [
            worker_python,
            "-m",
            "skills.twin._runtime.realtime.pipecat_worker",
            "--session-file",
            str(session_file_path),
        ]

        env = os.environ.copy()
        env.update(self.runtime_env_loader())

        # Persist the latest runner plan/runtime snapshot before the worker reads the session file.
        self._write_session(session_file_path, session_payload)

        with log_path.open("ab") as log_file:
            process = subprocess.Popen(
                command,
                stdout=log_file,
                stderr=subprocess.STDOUT,
                stdin=subprocess.DEVNULL,
                cwd=str(self.project_root),
                env=env,
                start_new_session=True,
            )

        time.sleep(0.75)
        alive = self._pid_is_alive(process.pid)
        exit_code = process.poll()
        log_excerpt = ""
        try:
            if log_path.exists():
                excerpt = log_path.read_text(encoding="utf-8", errors="replace")[-4000:].strip()
                log_excerpt = excerpt
        except OSError:
            log_excerpt = ""

        return {
            "pid": process.pid,
            "command": command,
            "log_path": str(log_path),
            "started_at": self.utc_now_iso(),
            "alive": alive,
            "exit_code": exit_code,
            "log_excerpt": log_excerpt,
        }

    def _public_join_url(self, invite_token: str) -> str:
        base_url = self.runtime_env_loader().get("TWIN_PUBLIC_BASE_URL", "http://localhost:5175").rstrip("/")
        return f"{base_url}/join/{invite_token}"

    def _token_hash(self, token: str) -> str:
        return hashlib.sha256(token.encode("utf-8")).hexdigest()

    def _required_env_status(self) -> dict[str, str]:
        env = self.runtime_env_loader()
        return {
            "LIVEAVATAR_API_KEY": "configured" if env.get("LIVEAVATAR_API_KEY") else "missing",
            "LIVEAVATAR_AVATAR_ID": "configured" if env.get("LIVEAVATAR_AVATAR_ID") else "missing",
            "DEEPGRAM_API_KEY": "configured" if env.get("DEEPGRAM_API_KEY") else "missing",
            "OPENAI_API_KEY": "configured" if env.get("OPENAI_API_KEY") else "missing",
            "ELEVENLABS_API_KEY": "configured" if env.get("ELEVENLABS_API_KEY") else "missing",
            "ELEVENLABS_VOICE_ID": "configured" if (env.get("ELEVENLABS_VOICE_ID") or self._profile_payload().get("voice_id")) else "missing",
        }

    def _missing_env(self, status: dict[str, str]) -> list[str]:
        return [key for key, value in status.items() if value != "configured"]

    def _runtime(self) -> TwinRealtimeRuntimeCoordinator:
        client = LiveAvatarClient()
        return TwinRealtimeRuntimeCoordinator(
            build_runner_plan=lambda **kwargs: build_runner_plan(
                session_payload=kwargs["session_payload"],
                session_file_path=str(kwargs["session_file_path"]),
                worker_path=str(self.project_root / "skills" / "twin" / "_runtime" / "realtime" / "pipecat_worker.py"),
            ),
            start_liveavatar_session=client.start_lite_session,
            stop_liveavatar_session=client.stop_session,
            spawn_worker=lambda **kwargs: self._spawn_worker(
                session_payload=kwargs["session_payload"],
                session_file_path=Path(str(kwargs["session_file_path"])),
            ),
            pid_is_alive=self._pid_is_alive,
            terminate_process=self._terminate_process,
            now_iso=self.utc_now_iso,
        )

    def list_sessions(self) -> list[dict[str, Any]]:
        if not self.video_sessions_dir.exists():
            return []
        items: list[dict[str, Any]] = []
        for path in sorted(self.video_sessions_dir.glob("*.json"), reverse=True):
            payload = self._safe_read_json(path)
            if payload:
                items.append(payload)
        return items

    def get_session(self, video_session_id: str) -> dict[str, Any] | None:
        path = self._session_path(video_session_id)
        return self._safe_read_json(path) if path.exists() else None

    def get_session_by_invite(self, invite_token: str) -> dict[str, Any] | None:
        invite_digest = self._token_hash(invite_token)
        for session in self.list_sessions():
            if session.get("invite_token_hash") == invite_digest:
                return session
        return None

    def public_session_view(self, payload: dict[str, Any]) -> dict[str, Any]:
        return realtime_domain.public_session_view(payload)

    def create_session(
        self,
        *,
        title: str,
        goal: str,
        counterpart_name: str | None = None,
        workspace_notes: list[str] | None = None,
    ) -> dict[str, Any]:
        profile = self._profile_payload()
        compiled_context = self._load_realtime_context(profile)
        try:
            from .realtime_context import augment_realtime_context
            compiled_context = augment_realtime_context(
                compiled_context,
                title=title,
                goal=goal,
                counterpart_name=counterpart_name or "Guest",
                workspace_notes=list(workspace_notes or []),
            )
        except Exception:
            pass
        env_status = self._required_env_status()
        missing = self._missing_env(env_status)

        current_id = self.session_id()
        invite_token = secrets.token_urlsafe(24)
        created_at = self.utc_now_iso()
        payload = realtime_domain.build_session_payload(
            video_session_id=current_id,
            title=title,
            goal=goal,
            counterpart_name=counterpart_name or "Guest",
            profile_slug=self.profile_slug,
            profile=profile,
            env_status=env_status,
            missing_env=missing,
            join_url=self._public_join_url(invite_token),
            compiled_context=compiled_context,
            workspace_notes=list(workspace_notes or []),
            created_at=created_at,
        )
        payload["invite_token_hash"] = self._token_hash(invite_token)
        path = self._session_path(current_id)
        self._write_session(path, payload)
        response = dict(payload)
        response["invite_token"] = invite_token
        return response

    def start_session(self, video_session_id: str) -> dict[str, Any]:
        payload = self.get_session(video_session_id)
        if not payload:
            raise RuntimeError("Video session not found.")
        path = self._session_path(video_session_id)
        payload = self._runtime().start_session(
            payload=payload,
            session_file_path=str(path),
            session_id=video_session_id,
        )
        self._write_session(path, payload)
        return payload

    def end_session(self, video_session_id: str) -> dict[str, Any]:
        payload = self.get_session(video_session_id)
        if not payload:
            raise RuntimeError("Video session not found.")
        payload = self._runtime().end_session(payload=payload)
        self._write_session(self._session_path(video_session_id), payload)
        return payload

    def delete_session(self, video_session_id: str) -> dict[str, Any]:
        path = self._session_path(video_session_id)
        payload = self.get_session(video_session_id)
        if not payload:
            raise RuntimeError("Video session not found.")

        if payload.get("status") != "ended":
            payload = self._runtime().end_session(payload=payload)
            self._write_session(path, payload)

        log_path = self._session_log_path(video_session_id)
        path.unlink(missing_ok=True)
        log_path.unlink(missing_ok=True)
        return {
            "ok": True,
            "video_session_id": video_session_id,
            "deleted_session_path": str(path),
            "deleted_log_path": str(log_path),
        }

    def session_debug_snapshot(self) -> dict[str, Any]:
        profile = self._profile_payload()
        return realtime_domain.build_debug_snapshot(
            profile=profile,
            recent_calls=self.storage_reader.list_all_calls(),
            recent_delegations=self.storage_reader.list_delegations(),
        )
