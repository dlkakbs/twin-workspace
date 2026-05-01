from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any, Callable


def clear_scheduled_metadata(task: dict[str, Any]) -> dict[str, Any]:
    metadata = dict(task.get("metadata") or {})
    metadata.pop("scheduled_job_id", None)
    metadata.pop("scheduled_job_next_run_at", None)
    metadata.pop("scheduled_job_script", None)
    task["metadata"] = metadata
    return task


def execute_scheduled_delegation(
    *,
    delegation_path: str | Path,
    source: str,
    remove_cron_job: Callable[[dict[str, Any]], None],
    persist_task: Callable[[str | Path, dict[str, Any]], None],
    call_run: Callable[..., dict[str, Any]],
    run_video_call: Callable[..., dict[str, Any]],
    spawn_content_run_process: Callable[..., int],
    spawn_call_log_process: Callable[..., None],
    record_failure: Callable[..., None],
) -> dict[str, Any]:
    path = Path(delegation_path).resolve()
    task = json.loads(path.read_text(encoding="utf-8"))
    channel = str(task.get("channel") or "voice_call")
    status = str(task.get("status") or "").strip().lower()
    authority = task.get("authority") or {}
    metadata = task.get("metadata") or {}

    if status == "completed":
        return {"status": "skipped", "reason": "delegation already completed"}

    if channel in {"voice_call", "video_call"} and authority.get("approval_required") and not metadata.get("pre_call_approved_at"):
        return {"status": "blocked", "reason": "waiting_for_pre_call_approval", "channel": channel, "source": source}

    clear_scheduled_metadata(task)
    persist_task(path, task)

    try:
        if channel == "content_creation":
            task["status"] = "running"
            metadata = dict(task.get("metadata") or {})
            metadata["content_run_log_path"] = str(path.parent / "logs" / "content-run.log")
            metadata["content_run_source"] = source
            pid = spawn_content_run_process(
                delegation_path=str(path),
                source=source,
            )
            metadata["content_run_pid"] = pid
            task["metadata"] = metadata
            persist_task(path, task)
            return {"status": "running", "channel": channel, "source": source, "mode": "detached"}

        if channel == "video_call":
            return run_video_call(
                delegation_path=str(path),
                source=source,
            )

        result = call_run(delegation_path=str(path))
        conversation_id = result.get("conversation_id")
        call_run_path = result.get("call_run_path")
        call_sid = result.get("call_sid")
        if conversation_id and call_run_path:
            spawn_call_log_process(
                delegation_path=str(path),
                call_run_path=str(call_run_path),
                conversation_id=str(conversation_id),
                call_sid=str(call_sid) if call_sid else None,
            )
        return {"status": "running", "channel": channel, "result": result, "source": source}
    except Exception as exc:
        failed_task = json.loads(path.read_text(encoding="utf-8"))
        remove_cron_job(failed_task)
        clear_scheduled_metadata(failed_task)
        record_failure(
            delegation_path=path,
            task=failed_task,
            error=str(exc),
            source=source,
        )
        raise


def recover_due_delegations(
    *,
    tasks: list[dict[str, Any]],
    execute_delegation: Callable[..., dict[str, Any]],
    now: datetime | None = None,
) -> None:
    current_time = now or datetime.now().astimezone()
    for task in tasks:
        metadata = task.get("metadata") or {}
        scheduled_for = task.get("scheduled_for")
        if not scheduled_for:
            continue

        status = str(task.get("status") or "").strip().lower()
        if status in {"completed", "running", "failed"}:
            continue

        try:
            run_at = datetime.fromisoformat(str(scheduled_for).replace("Z", "+00:00")).astimezone()
        except ValueError:
            continue

        if run_at > current_time:
            continue

        if metadata.get("scheduled_job_id") or metadata.get("scheduled_job_script"):
            continue

        task_path = task.get("_path")
        if not task_path:
            continue

        execute_delegation(
            delegation_path=str(task_path),
            source="backend-ticker",
        )


def sync_pending_heygen_videos(
    *,
    tasks: list[dict[str, Any]],
    storage_reader_module,
    runs_dir: Path,
    run_heygen_json: Callable[..., dict[str, Any]],
    run_heygen_plain: Callable[..., None],
    extract_timeout_video_id: Callable[[str], str | None],
    humanize_provider_error: Callable[[str], str],
    persist_task: Callable[[str | Path, dict[str, Any]], None],
) -> None:
    for task in tasks:
        if task.get("channel") != "content_creation":
            continue

        metadata = dict(task.get("metadata") or {})
        video_id = metadata.get("heygen_video_id") or extract_timeout_video_id(
            str(metadata.get("last_error_raw") or metadata.get("last_error") or "")
        )
        if not video_id:
            continue
        metadata["heygen_video_id"] = str(video_id)

        path = Path(task["_path"]).resolve()
        try:
            current = run_heygen_json("video", "get", str(video_id))
        except Exception:
            continue

        data = current.get("data") or {}
        remote_status = str(data.get("status") or "").strip().lower()
        metadata["heygen_video_status"] = remote_status or "processing"

        refreshed = storage_reader_module.get_delegation(task.get("delegation_id", ""))
        if refreshed and refreshed.get("latest_content_run"):
            task["latest_content_run"] = refreshed.get("latest_content_run")

        if remote_status == "completed":
            latest_run = storage_reader_module.get_delegation(task.get("delegation_id", ""))
            latest_payload = (latest_run or {}).get("latest_content_run") or task.get("latest_content_run") or {}
            run_id = latest_payload.get("run_id")
            if run_id:
                video_path = runs_dir / str(run_id) / "avatar.mp4"
                try:
                    run_heygen_plain("video", "download", str(video_id), "--output-path", str(video_path), "--force")
                except Exception as exc:
                    metadata["last_error"] = humanize_provider_error(str(exc))
                    metadata["last_error_raw"] = str(exc)
                    metadata["last_error_source"] = "heygen_poll"
                    task["metadata"] = metadata
                    task["status"] = "running"
                    persist_task(path, task)
                    continue

                rehydrated = storage_reader_module.get_delegation(task.get("delegation_id", ""))
                if rehydrated and rehydrated.get("latest_content_run"):
                    task["latest_content_run"] = rehydrated.get("latest_content_run")
                metadata.pop("content_run_pid", None)
                metadata.pop("heygen_video_id", None)
                metadata.pop("heygen_video_status", None)
                metadata.pop("last_error", None)
                metadata.pop("last_error_raw", None)
                metadata.pop("last_error_source", None)
                task["metadata"] = metadata
                task["status"] = "completed"
                persist_task(path, task)
                continue

        if remote_status == "failed":
            error = " | ".join(
                str(part).strip() for part in (data.get("failure_code"), data.get("failure_message")) if part
            ) or json.dumps(current)
            metadata.pop("content_run_pid", None)
            metadata["last_error"] = humanize_provider_error(f"HeyGen video failed: {error}")
            metadata["last_error_raw"] = json.dumps(current, ensure_ascii=False)
            metadata["last_error_source"] = "heygen_poll"
            task["metadata"] = metadata
            task["status"] = "failed"
            persist_task(path, task)
            continue

        task["metadata"] = metadata
        task["status"] = "running"
        persist_task(path, task)
