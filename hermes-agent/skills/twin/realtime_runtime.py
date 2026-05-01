from __future__ import annotations

from typing import Any, Callable


class TwinRealtimeRuntimeCoordinator:
    """Provider-agnostic realtime session lifecycle coordinator."""

    def __init__(
        self,
        *,
        build_runner_plan: Callable[..., dict[str, Any]],
        start_liveavatar_session: Callable[..., dict[str, Any]],
        stop_liveavatar_session: Callable[..., dict[str, Any]],
        spawn_worker: Callable[..., dict[str, Any]],
        pid_is_alive: Callable[[int], bool],
        terminate_process: Callable[[int], None],
        now_iso: Callable[[], str],
    ) -> None:
        self.build_runner_plan = build_runner_plan
        self.start_liveavatar_session = start_liveavatar_session
        self.stop_liveavatar_session = stop_liveavatar_session
        self.spawn_worker = spawn_worker
        self.pid_is_alive = pid_is_alive
        self.terminate_process = terminate_process
        self.now_iso = now_iso

    def start_session(
        self,
        *,
        payload: dict[str, Any],
        session_file_path: str,
        session_id: str,
    ) -> dict[str, Any]:
        if payload.get("missing_env"):
            raise RuntimeError("Cannot start video session until required environment variables are configured.")

        runtime = payload.setdefault("runtime", {})
        worker_process = runtime.get("worker_process") or {}
        existing_pid = worker_process.get("pid")
        if isinstance(existing_pid, int) and self.pid_is_alive(existing_pid):
            payload["status"] = "active"
            payload["updated_at"] = self.now_iso()
            runtime["runner_status"] = "running"
            worker_process["alive"] = True
            runtime["worker_process"] = worker_process
            return payload

        payload["status"] = "wiring_in_progress"
        payload["updated_at"] = self.now_iso()
        runtime["runner_status"] = "planned"
        runtime["runner_plan"] = self.build_runner_plan(
            session_payload=payload,
            session_file_path=session_file_path,
        )
        livekit = (runtime.get("runner_plan") or {}).get("livekit") or {}
        if livekit.get("status") != "configured":
            raise RuntimeError("LiveKit room credentials are not configured.")
        try:
            runtime["liveavatar_session"] = self.start_liveavatar_session(
                session_id=session_id,
                counterpart_name=str(payload.get("counterpart_name") or "Guest"),
                livekit_url=str(livekit["url"]),
                livekit_room=str(livekit["room_name"]),
                avatar_token=str(livekit["avatar_token"]),
            )
            payload["provider_state"]["liveavatar"] = "started"
            runtime.pop("liveavatar_error", None)
        except RuntimeError as exc:
            payload["status"] = "bootstrap_failed"
            payload["updated_at"] = self.now_iso()
            runtime["runner_status"] = "bootstrap_failed"
            payload["provider_state"]["liveavatar"] = "error"
            runtime["liveavatar_error"] = str(exc)
            raise

        spawned = self.spawn_worker(
            session_payload=payload,
            session_file_path=session_file_path,
        )
        if not spawned.get("alive", False):
            payload["status"] = "bootstrap_failed"
            payload["updated_at"] = self.now_iso()
            runtime["runner_status"] = "bootstrap_failed"
            payload["provider_state"]["pipecat"] = "error"
            runtime["worker_process"] = spawned
            log_excerpt = str(spawned.get("log_excerpt") or "").strip()
            if log_excerpt:
                runtime["worker_error"] = log_excerpt
            raise RuntimeError("Pipecat worker exited during startup.")
        payload["status"] = "active"
        payload["updated_at"] = self.now_iso()
        runtime["runner_status"] = "running"
        payload["provider_state"]["pipecat"] = "running"
        runtime["worker_process"] = {
            **spawned,
            "alive": self.pid_is_alive(spawned["pid"]),
        }
        payload["artifacts"]["session_log_path"] = spawned["log_path"]
        return payload

    def end_session(self, *, payload: dict[str, Any]) -> dict[str, Any]:
        liveavatar_session = (payload.get("runtime") or {}).get("liveavatar_session") or {}
        remote_session_id = liveavatar_session.get("session_id")
        if remote_session_id:
            try:
                stop_result = self.stop_liveavatar_session(
                    session_id=str(remote_session_id),
                    reason="USER_CLOSED",
                )
                payload["runtime"]["liveavatar_stop"] = {
                    "status": "stopped",
                    "response": stop_result,
                    "stopped_at": self.now_iso(),
                }
            except RuntimeError as exc:
                payload["runtime"]["liveavatar_stop"] = {
                    "status": "error",
                    "error": str(exc),
                    "stopped_at": self.now_iso(),
                }

        runner = (payload.get("runtime") or {}).get("worker_process") or {}
        pid = runner.get("pid")
        if isinstance(pid, int):
            self.terminate_process(pid)

        payload["status"] = "ended"
        payload["ended_at"] = self.now_iso()
        payload["updated_at"] = self.now_iso()
        payload["runtime"]["runner_status"] = "stopped"
        payload["provider_state"]["pipecat"] = "stopped"
        payload["provider_state"]["liveavatar"] = "stopped"
        payload["runtime"]["worker_process"] = {
            **runner,
            "ended_at": payload["ended_at"],
            "alive": self.pid_is_alive(pid) if isinstance(pid, int) else False,
            "stop_requested": True,
        }
        return payload
