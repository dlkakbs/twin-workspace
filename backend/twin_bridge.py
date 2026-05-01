"""
Workspace bridge to Twin services and runtimes hosted under Hermes.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from config import HERMES_ROOT, TWIN_SUMMARY_LANGUAGE
from env_utils import HERMES_HOME_ENV, twin_workspace_api, twin_workspace_contract
from hermes_imports import ensure_hermes_import_path
import storage_reader
from workspace_paths import profile_json_path

ensure_hermes_import_path(HERMES_ROOT)

from skills.twin._runtime.telephony.providers import send_twilio_sms as runtime_send_twilio_sms
from skills.twin.workspace_commands import (
    create_workspace_maintenance_ticker,
    extract_timeout_video_id as hermes_extract_timeout_video_id,
    humanize_provider_error as hermes_humanize_provider_error,
    remove_delegation_cron_job,
    run_video_call_for_contract,
    schedule_delegation_cron_job,
    spawn_content_run_process as hermes_spawn_content_run_process,
    spawn_scheduled_call_logger_process,
    wait_for_call_connection_for_contract,
    wait_for_conversation_and_log_for_contract,
)
from skills.twin._runtime.bridge.processes import terminate_process_group

_CRON_TICKER: Any | None = None


def _workspace_api():
    return twin_workspace_api()


def _import_hermes_module(module_name: str):
    ensure_hermes_import_path(HERMES_ROOT)
    return __import__(module_name, fromlist=["*"])


def _workspace_command_args() -> list[str]:
    return twin_workspace_contract().workspace_command_args()


def _persist_task(path: str | Path, task: dict[str, Any]) -> None:
    Path(path).write_text(json.dumps(task, indent=2, ensure_ascii=False), encoding="utf-8")


def _humanize_provider_error(error: str) -> str:
    return hermes_humanize_provider_error(error)


def _extract_timeout_video_id(error: str) -> str | None:
    return hermes_extract_timeout_video_id(error)


def _record_delegation_failure(
    *,
    delegation_path: str | Path,
    task: dict[str, Any],
    error: str,
    source: str,
) -> None:
    metadata = dict(task.get("metadata") or {})
    metadata["last_error"] = _humanize_provider_error(error)
    metadata["last_error_raw"] = error
    metadata["last_error_source"] = source
    task["metadata"] = metadata
    task["status"] = "failed"
    _persist_task(delegation_path, task)


def _terminate_content_run_process(pid: int | None) -> bool:
    return terminate_process_group(pid)


def send_twilio_sms(*, to_number: str, body: str) -> dict[str, Any]:
    return runtime_send_twilio_sms(env_path=HERMES_HOME_ENV, to_number=to_number, body=body)


def delegate_create(
    *,
    counterpart_name: str,
    counterpart_phone: str,
    task_type: str,
    channel: str = "voice_call",
    content_subtype: str | None = None,
    video_meeting_intent: str | None = None,
    video_meeting_setup: str | None = None,
    video_generation_mode: str | None = None,
    goal: str,
    scheduled_for: str | None = None,
    context_notes: list[str] | None = None,
    autonomous_actions: list[str] | None = None,
    approval_required: list[str] | None = None,
    forbidden_actions: list[str] | None = None,
    title: str | None = None,
) -> dict[str, Any]:
    return _workspace_api().create_workspace_delegation(
        profile_path=profile_json_path(),
        counterpart_name=counterpart_name,
        counterpart_phone=counterpart_phone,
        task_type=task_type,
        channel=channel,
        goal=goal,
        scheduled_for=scheduled_for,
        context_notes=context_notes,
        autonomous_actions=autonomous_actions,
        approval_required=approval_required,
        forbidden_actions=forbidden_actions,
        title=title,
        content_subtype=content_subtype,
        video_meeting_intent=video_meeting_intent,
        video_meeting_setup=video_meeting_setup,
        video_generation_mode=video_generation_mode,
        schedule_job=lambda **kwargs: schedule_delegation_cron_job(
            contract=twin_workspace_contract(),
            **kwargs,
        ),
        remove_job=lambda task: remove_delegation_cron_job(task=task),
        send_sms=send_twilio_sms,
    )


def delegate_update(
    *,
    delegation_path: str,
    counterpart_name: str,
    counterpart_phone: str,
    task_type: str,
    channel: str = "voice_call",
    content_subtype: str | None = None,
    video_meeting_intent: str | None = None,
    video_meeting_setup: str | None = None,
    video_generation_mode: str | None = None,
    goal: str,
    scheduled_for: str | None = None,
    context_notes: list[str] | None = None,
    autonomous_actions: list[str] | None = None,
    approval_required: list[str] | None = None,
    forbidden_actions: list[str] | None = None,
    title: str | None = None,
) -> dict[str, Any]:
    resolved_path = str(Path(delegation_path).expanduser().resolve())
    return _workspace_api().update_workspace_delegation(
        delegation_path=resolved_path,
        counterpart_name=counterpart_name,
        counterpart_phone=counterpart_phone,
        task_type=task_type,
        channel=channel,
        content_subtype=content_subtype,
        video_meeting_intent=video_meeting_intent,
        video_meeting_setup=video_meeting_setup,
        video_generation_mode=video_generation_mode,
        goal=goal,
        scheduled_for=scheduled_for,
        context_notes=context_notes,
        autonomous_actions=autonomous_actions,
        approval_required=approval_required,
        forbidden_actions=forbidden_actions,
        title=title,
        schedule_job=lambda **kwargs: schedule_delegation_cron_job(
            contract=twin_workspace_contract(),
            **kwargs,
        ),
        remove_job=lambda task: remove_delegation_cron_job(task=task),
        send_sms=send_twilio_sms,
    )


def call_run(*, delegation_path: str) -> dict[str, Any]:
    return _workspace_api().run_call_with_workspace_cleanup(
        delegation_path=delegation_path,
        run_video_call=video_call_run,
        remove_job=lambda task: remove_delegation_cron_job(task=task),
    )


def video_call_run(*, delegation_path: str, source: str) -> dict[str, Any]:
    return run_video_call_for_contract(
        contract=twin_workspace_contract(),
        delegation_path=delegation_path,
        source=source,
        storage_reader_module=storage_reader,
    )


def content_run(*, delegation_path: str) -> dict[str, Any]:
    return _workspace_api().run_content_with_workspace_cleanup(
        delegation_path=Path(delegation_path).expanduser().resolve(),
        remove_job=lambda task: remove_delegation_cron_job(task=task),
        read_delegation=storage_reader.get_delegation,
        extract_timeout_video_id=_extract_timeout_video_id,
        humanize_provider_error=_humanize_provider_error,
    )


def _spawn_call_log_process(
    *,
    delegation_path: str,
    call_run_path: str,
    conversation_id: str,
    call_sid: str | None = None,
) -> None:
    spawn_scheduled_call_logger_process(
        contract=twin_workspace_contract(),
        delegation_path=delegation_path,
        call_run_path=call_run_path,
        conversation_id=conversation_id,
        call_sid=call_sid,
        summary_language=TWIN_SUMMARY_LANGUAGE,
    )


def _spawn_content_run_process(*, delegation_path: str, source: str) -> int:
    return hermes_spawn_content_run_process(
        contract=twin_workspace_contract(),
        delegation_path=delegation_path,
        source=source,
    )


def execute_scheduled_delegation(*, delegation_path: str, source: str = "cron") -> dict[str, Any]:
    return _workspace_api().execute_scheduled_delegation(
        delegation_path=delegation_path,
        source=source,
        remove_cron_job=lambda task: remove_delegation_cron_job(task=task),
        persist_task=_persist_task,
        call_run=call_run,
        run_video_call=video_call_run,
        spawn_content_run_process=_spawn_content_run_process,
        spawn_call_log_process=_spawn_call_log_process,
        record_failure=_record_delegation_failure,
    )


def cancel_delegation(*, delegation_path: str) -> dict[str, Any]:
    path = Path(delegation_path).resolve()
    if not path.exists():
        raise RuntimeError("Delegation not found.")
    return _workspace_api().cancel_content_run_for_delegation(
        path,
        terminate_process=_terminate_content_run_process,
    )


def delete_delegation(*, delegation_path: str) -> dict[str, Any]:
    path = Path(delegation_path).resolve()
    if not path.exists():
        raise RuntimeError("Delegation not found.")
    task = json.loads(path.read_text(encoding="utf-8"))
    remove_delegation_cron_job(task=task)
    return _workspace_api().delete_delegation(path)


def call_log(
    *,
    delegation_path: str,
    status: str,
    summary: str,
    outcome: str,
    next_steps: list[str] | None = None,
    pending_approvals: list[str] | None = None,
    notes: list[str] | None = None,
    transcript_path: str | Path | None = None,
) -> dict[str, Any]:
    return _workspace_api().log_call(
        delegation_path=Path(delegation_path).expanduser().resolve(),
        status=status,
        summary=summary,
        outcome=outcome,
        next_steps=next_steps,
        pending_approvals=pending_approvals,
        notes=notes,
        transcript_path=Path(str(transcript_path)).expanduser().resolve() if transcript_path else None,
    )


def wait_for_call_connection_and_mark_safe(
    *,
    call_run_path: str,
    call_sid: str,
    timeout_seconds: int = 35,
    poll_interval_seconds: int = 5,
) -> None:
    wait_for_call_connection_for_contract(
        contract=twin_workspace_contract(),
        call_run_path=call_run_path,
        call_sid=call_sid,
        timeout_seconds=timeout_seconds,
        poll_interval_seconds=poll_interval_seconds,
    )


def wait_for_conversation_and_log_safe(
    *,
    delegation_path: str,
    call_run_path: str,
    conversation_id: str,
    timeout_seconds: int = 900,
    poll_interval_seconds: int = 10,
) -> None:
    wait_for_conversation_and_log_for_contract(
        contract=twin_workspace_contract(),
        delegation_path=delegation_path,
        call_run_path=call_run_path,
        conversation_id=conversation_id,
        timeout_seconds=timeout_seconds,
        poll_interval_seconds=poll_interval_seconds,
        summary_language=TWIN_SUMMARY_LANGUAGE,
    )


def tick_cron_scheduler() -> None:
    cron_scheduler = _import_hermes_module("cron.scheduler")
    cron_scheduler.tick(verbose=False)

def start_cron_ticker(interval_seconds: int = 30) -> None:
    global _CRON_TICKER
    if _CRON_TICKER is None:
        _CRON_TICKER = create_workspace_maintenance_ticker(
            contract=twin_workspace_contract(),
            storage_reader_module=storage_reader,
            execute_delegation=execute_scheduled_delegation,
            tick_cron_scheduler=tick_cron_scheduler,
            interval_seconds=interval_seconds,
        )
    _CRON_TICKER.start()


def stop_cron_ticker() -> None:
    if _CRON_TICKER is not None:
        _CRON_TICKER.stop()
