from __future__ import annotations

import json
import re
import shutil
from datetime import datetime
from pathlib import Path
from typing import Any

from .profile_service import TwinProfileService
from .settings_service import TwinSettingsService
from .skill import TwinSkill
from .storage import TwinStorage
from .video_call_workflow import build_video_prep_message
from skills.twin._runtime.bridge.workflows import (
    execute_scheduled_delegation as runtime_execute_scheduled_delegation,
    recover_due_delegations,
    sync_pending_heygen_videos,
)


class TwinWorkspaceAPI:
    """Stable facade for workspace/control-plane integrations."""

    def __init__(
        self,
        *,
        project_root: Path,
        output_root: Path,
        env_path: Path,
        profile_slug: str,
    ) -> None:
        self.project_root = Path(project_root).expanduser().resolve()
        self.output_root = Path(output_root).expanduser().resolve()
        self.env_path = Path(env_path).expanduser().resolve()
        self.profile_slug = profile_slug
        self.storage = TwinStorage(self.output_root)
        self.storage.ensure()
        self.profile_service = TwinProfileService(self.storage)
        self.settings_service = TwinSettingsService(
            env_path=self.env_path,
            profile_service=self.profile_service,
            profile_slug=self.profile_slug,
        )
        self.skill = TwinSkill(project_root=self.project_root)

    def get_profile(self):
        return self.profile_service.get_profile(self.profile_slug)

    def update_profile(self, patch: dict[str, Any]):
        return self.profile_service.update_profile(self.profile_slug, patch)

    def update_photo_path(self, photo_path: Path):
        return self.profile_service.update_photo_path(self.profile_slug, photo_path)

    def read_settings(self) -> dict[str, str]:
        return self.settings_service.read_env()

    def write_setting(self, key: str, value: str) -> None:
        self.settings_service.write_key(key, value)

    def remove_setting(self, key: str) -> None:
        self.settings_service.remove_key(key)

    def update_profile_voice_id(self, voice_id: str) -> None:
        self.settings_service.update_profile_voice_id(voice_id)

    def _read_delegation(self, delegation_path: Path | str) -> tuple[Path, dict[str, Any]]:
        path = Path(delegation_path).expanduser().resolve()
        return path, json.loads(path.read_text(encoding="utf-8"))

    def assert_manual_run_allowed(self, delegation_path: Path | str) -> dict[str, Any]:
        _path, task = self._read_delegation(delegation_path)
        authority = task.get("authority") or {}
        metadata = task.get("metadata") or {}
        if str(task.get("channel") or "").strip() != "content_creation" and authority.get("approval_required") and not metadata.get("pre_call_approved_at"):
            detail = "This run still needs your approval before Twin can start it."
            if str(task.get("channel") or "").strip() == "video_call":
                detail = "This meeting still needs your approval before Twin can start it and send the invite."
            raise RuntimeError(detail)
        return task

    def approve_pre_call(self, delegation_path: Path | str) -> dict[str, Any]:
        path = Path(delegation_path).expanduser().resolve()
        task = json.loads(path.read_text(encoding="utf-8"))
        authority = task.get("authority") or {}
        metadata = dict(task.get("metadata") or {})

        if not authority.get("approval_required"):
            return {
                "ok": True,
                "pre_call_approved_at": metadata.get("pre_call_approved_at"),
                "scheduled_run_state": "not_scheduled" if not task.get("scheduled_for") else "scheduled",
            }

        now = datetime.now().astimezone()
        metadata["pre_call_approved_at"] = now.isoformat()
        task["metadata"] = metadata
        path.write_text(json.dumps(task, indent=2, ensure_ascii=False), encoding="utf-8")

        scheduled_for_raw = task.get("scheduled_for")
        if not scheduled_for_raw:
            scheduled_run_state = "not_scheduled"
        else:
            try:
                scheduled_for = datetime.fromisoformat(str(scheduled_for_raw).replace("Z", "+00:00"))
            except ValueError:
                scheduled_run_state = "not_scheduled"
            else:
                scheduled_run_state = "past_due" if scheduled_for <= now else "scheduled"

        return {
            "ok": True,
            "pre_call_approved_at": metadata["pre_call_approved_at"],
            "scheduled_run_state": scheduled_run_state,
        }

    def create_delegation(self, **kwargs):
        return self.skill.create_delegation(**kwargs)

    def create_workspace_delegation(
        self,
        *,
        profile_path: Path | str,
        counterpart_name: str,
        counterpart_phone: str,
        task_type: str,
        channel: str,
        goal: str,
        scheduled_for: str | None = None,
        context_notes: list[str] | None = None,
        autonomous_actions: list[str] | None = None,
        approval_required: list[str] | None = None,
        forbidden_actions: list[str] | None = None,
        title: str | None = None,
        content_subtype: str | None = None,
        video_meeting_intent: str | None = None,
        video_meeting_setup: str | None = None,
        video_generation_mode: str | None = None,
        schedule_job: Any,
        remove_job: Any,
        send_sms: Any,
    ) -> dict[str, Any]:
        result = self.create_delegation(
            profile_path=Path(profile_path).expanduser().resolve(),
            counterpart_name=counterpart_name,
            goal=goal,
            scheduled_for=scheduled_for,
            channel=channel,
            counterpart_phone=counterpart_phone,
            title=title,
            task_type=task_type,
            context_notes=context_notes,
            autonomous_actions=autonomous_actions,
            approval_required=approval_required,
            forbidden_actions=forbidden_actions,
            content_subtype=content_subtype,
            video_meeting_intent=video_meeting_intent,
            video_meeting_setup=video_meeting_setup,
        )
        delegation_path = result.get("delegation_path")
        if not delegation_path:
            return result

        path, task = self._read_delegation(delegation_path)
        metadata = dict(task.get("metadata") or {})
        if video_generation_mode:
            metadata["video_generation_mode"] = video_generation_mode
            task["metadata"] = metadata
            path.write_text(json.dumps(task, indent=2, ensure_ascii=False), encoding="utf-8")

        if scheduled_for:
            scheduled = self.apply_schedule_to_delegation(
                delegation_path=path,
                scheduled_for=scheduled_for,
                title=title or goal,
                channel=channel,
                schedule_job=schedule_job,
                remove_job=remove_job,
            )
            result["scheduled_job_id"] = scheduled.get("scheduled_job_id")
            result["scheduled_job_next_run_at"] = scheduled.get("scheduled_job_next_run_at")

        if channel == "video_call":
            prep = self.prepare_video_call_invite_for_delegation(path, send_sms=send_sms)
            if prep:
                result.update(prep)
        return result

    def update_delegation(
        self,
        *,
        delegation_path: Path | str,
        send_sms: Any | None = None,
        **kwargs: Any,
    ) -> dict[str, Any]:
        result = self.skill.update_delegation(
            delegation_path=Path(delegation_path).expanduser().resolve(),
            **kwargs,
        )
        if send_sms:
            prep = self.prepare_video_call_invite_for_delegation(
                result["delegation_path"],
                send_sms=send_sms,
            )
            if prep:
                result.update(prep)
        return result

    def update_workspace_delegation(
        self,
        *,
        delegation_path: Path | str,
        counterpart_name: str,
        counterpart_phone: str,
        task_type: str,
        channel: str,
        goal: str,
        scheduled_for: str | None = None,
        context_notes: list[str] | None = None,
        autonomous_actions: list[str] | None = None,
        approval_required: list[str] | None = None,
        forbidden_actions: list[str] | None = None,
        title: str | None = None,
        content_subtype: str | None = None,
        video_meeting_intent: str | None = None,
        video_meeting_setup: str | None = None,
        video_generation_mode: str | None = None,
        schedule_job: Any,
        remove_job: Any,
        send_sms: Any,
    ) -> dict[str, Any]:
        result = self.update_delegation(
            delegation_path=Path(delegation_path).expanduser().resolve(),
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
            send_sms=send_sms,
        )
        scheduled = self.apply_schedule_to_delegation(
            delegation_path=Path(delegation_path).expanduser().resolve(),
            scheduled_for=scheduled_for,
            title=title or goal,
            channel=channel,
            schedule_job=schedule_job,
            remove_job=remove_job,
        )
        result["scheduled_job_id"] = scheduled.get("scheduled_job_id")
        result["scheduled_job_next_run_at"] = scheduled.get("scheduled_job_next_run_at")
        return result

    def call_run_for_delegation(self, delegation_path: Path | str):
        return self.skill.call_run(
            delegation_path=Path(delegation_path).expanduser().resolve(),
        )

    def run_call_with_workspace_cleanup(
        self,
        *,
        delegation_path: Path | str,
        run_video_call: Any,
        remove_job: Any,
    ) -> dict[str, Any]:
        path, task = self._read_delegation(delegation_path)
        if str(task.get("channel") or "").strip() == "video_call":
            result = run_video_call(delegation_path=str(path), source="manual")
        else:
            result = self.call_run_for_delegation(path)
        self.clear_scheduled_delegation(
            delegation_path=path,
            remove_job=remove_job,
        )
        return result

    def call_run(self, **kwargs):
        if "delegation_path" in kwargs:
            kwargs["delegation_path"] = Path(kwargs["delegation_path"]).expanduser().resolve()
        return self.skill.call_run(**kwargs)

    def generate(self, **kwargs):
        if "profile_path" in kwargs and kwargs["profile_path"] is not None:
            kwargs["profile_path"] = Path(kwargs["profile_path"]).expanduser().resolve()
        if "source_script_path" in kwargs and kwargs["source_script_path"] is not None:
            kwargs["source_script_path"] = Path(kwargs["source_script_path"]).expanduser().resolve()
        if "source_audio_path" in kwargs and kwargs["source_audio_path"] is not None:
            kwargs["source_audio_path"] = Path(kwargs["source_audio_path"]).expanduser().resolve()
        return self.skill.generate(**kwargs)

    def log_call(self, **kwargs):
        if "delegation_path" in kwargs:
            kwargs["delegation_path"] = Path(kwargs["delegation_path"]).expanduser().resolve()
        if "transcript_path" in kwargs and kwargs["transcript_path"] is not None:
            kwargs["transcript_path"] = Path(kwargs["transcript_path"]).expanduser().resolve()
        return self.skill.log_call(**kwargs)

    def log_call_for_delegation(
        self,
        *,
        delegation_path: Path | str,
        status: str,
        summary: str,
        outcome: str,
        next_steps: list[str] | None = None,
        pending_approvals: list[str] | None = None,
        notes: list[str] | None = None,
        transcript_path: Path | str | None = None,
    ):
        return self.log_call(
            delegation_path=Path(delegation_path).expanduser().resolve(),
            status=status,
            summary=summary,
            outcome=outcome,
            next_steps=next_steps,
            pending_approvals=pending_approvals,
            notes=notes,
            transcript_path=Path(transcript_path).expanduser().resolve() if transcript_path else None,
        )

    def generate_for_delegation(self, delegation_path: Path) -> dict[str, Any]:
        delegation = json.loads(Path(delegation_path).read_text(encoding="utf-8"))
        content_subtype = (delegation.get("metadata") or {}).get("content_subtype", "video")
        format_map = {
            "video": "video",
            "audio": "audio",
            "script": "script",
        }
        output_format = format_map.get(content_subtype, "video")
        context_notes = delegation.get("context_notes") or []
        context_block = "\n".join(f"- {note}" for note in context_notes if note)
        brief = str(delegation.get("goal") or "").strip()
        if context_block:
            brief = f"{brief}\n\nContext:\n{context_block}"
        metadata = delegation.get("metadata") or {}
        video_generation_mode = str(metadata.get("video_generation_mode") or "").strip().lower()
        source_script_path = metadata.get("source_script_path")
        source_audio_path = metadata.get("source_audio_path")
        return self.skill.generate(
            profile_path=self.storage.profile_json_path(self.profile_slug),
            brief=brief,
            output_format=output_format,
            with_avatar=output_format not in {"audio", "script"},
            source_script_path=Path(str(source_script_path)).expanduser().resolve() if source_script_path else None,
            source_audio_path=(
                Path(str(source_audio_path)).expanduser().resolve()
                if source_audio_path and video_generation_mode == "exact_audio"
                else None
            ),
        )

    def content_run_for_delegation(self, delegation_path: Path) -> dict[str, Any]:
        path = Path(delegation_path).expanduser().resolve()
        task = json.loads(path.read_text(encoding="utf-8"))
        task["status"] = "running"
        path.write_text(json.dumps(task, indent=2, ensure_ascii=False), encoding="utf-8")
        try:
            payload = self.generate_for_delegation(path)
        except Exception as exc:
            error_text = str(exc)
            match = re.search(r"HeyGen video ([a-f0-9]{32}) did not finish in time", error_text, re.IGNORECASE)
            if match:
                metadata = dict(task.get("metadata") or {})
                metadata.pop("content_run_pid", None)
                metadata["heygen_video_id"] = match.group(1)
                metadata["heygen_video_status"] = "processing"
                metadata["last_error"] = "HeyGen is still processing the video. Twin will keep checking automatically."
                metadata["last_error_raw"] = error_text
                metadata["last_error_source"] = "content_run"
                task["metadata"] = metadata
                task["status"] = "running"
                path.write_text(json.dumps(task, indent=2, ensure_ascii=False), encoding="utf-8")
                return {
                    "status": "processing",
                    "video_id": match.group(1),
                    "latest_content_run": task.get("latest_content_run"),
                }

            metadata = dict(task.get("metadata") or {})
            metadata["last_error"] = error_text
            metadata["last_error_raw"] = error_text
            metadata["last_error_source"] = "content_run"
            task["metadata"] = metadata
            task["status"] = "failed"
            path.write_text(json.dumps(task, indent=2, ensure_ascii=False), encoding="utf-8")
            raise RuntimeError(error_text)

        metadata = dict(task.get("metadata") or {})
        metadata.pop("content_run_pid", None)
        metadata.pop("heygen_video_id", None)
        metadata.pop("heygen_video_status", None)
        metadata.pop("last_error", None)
        metadata.pop("last_error_raw", None)
        metadata.pop("last_error_source", None)
        task["metadata"] = metadata
        task["status"] = "completed"
        task["latest_content_run"] = payload
        path.write_text(json.dumps(task, indent=2, ensure_ascii=False), encoding="utf-8")
        return payload

    def run_content_with_workspace_cleanup(
        self,
        *,
        delegation_path: Path | str,
        remove_job: Any,
        read_delegation: Any,
        extract_timeout_video_id: Any,
        humanize_provider_error: Any,
    ) -> dict[str, Any]:
        path, task = self._read_delegation(delegation_path)
        try:
            payload = self.content_run_for_delegation(path)
        except Exception as exc:
            error_text = str(exc)
            pending_video_id = extract_timeout_video_id(error_text)
            self.clear_scheduled_delegation(
                delegation_path=path,
                remove_job=remove_job,
            )
            refreshed = read_delegation(task.get("delegation_id", ""))
            if refreshed and refreshed.get("latest_content_run"):
                task["latest_content_run"] = refreshed.get("latest_content_run")
            if pending_video_id:
                metadata = dict(task.get("metadata") or {})
                metadata.pop("content_run_pid", None)
                metadata["heygen_video_id"] = pending_video_id
                metadata["heygen_video_status"] = "processing"
                metadata["last_error"] = "HeyGen is still processing the video. Twin will keep checking automatically."
                metadata["last_error_raw"] = error_text
                metadata["last_error_source"] = "content_run"
                task["metadata"] = metadata
                task["status"] = "running"
                path.write_text(json.dumps(task, indent=2, ensure_ascii=False), encoding="utf-8")
                return {
                    "status": "processing",
                    "video_id": pending_video_id,
                    "latest_content_run": task.get("latest_content_run"),
                }

            metadata = dict(task.get("metadata") or {})
            metadata["last_error"] = humanize_provider_error(error_text)
            metadata["last_error_raw"] = error_text
            metadata["last_error_source"] = "content_run"
            task["metadata"] = metadata
            task["status"] = "failed"
            path.write_text(json.dumps(task, indent=2, ensure_ascii=False), encoding="utf-8")
            raise RuntimeError(error_text)

        self.clear_scheduled_delegation(
            delegation_path=path,
            remove_job=remove_job,
        )
        refreshed_task = self.storage.read_json(path)
        metadata = dict(refreshed_task.get("metadata") or {})
        metadata.pop("content_run_pid", None)
        metadata.pop("heygen_video_id", None)
        metadata.pop("heygen_video_status", None)
        metadata.pop("last_error", None)
        metadata.pop("last_error_raw", None)
        metadata.pop("last_error_source", None)
        refreshed_task["metadata"] = metadata
        refreshed_task["status"] = "completed"
        refreshed_task["latest_content_run"] = payload
        path.write_text(json.dumps(refreshed_task, indent=2, ensure_ascii=False), encoding="utf-8")
        return payload

    def delete_delegation(self, delegation_path: Path | str) -> dict[str, Any]:
        path = Path(delegation_path).expanduser().resolve()
        if not path.exists():
            raise RuntimeError("Delegation not found.")
        shutil.rmtree(path.parent, ignore_errors=True)
        return {"ok": True, "deleted_path": str(path.parent)}

    def cancel_content_run_for_delegation(
        self,
        delegation_path: Path | str,
        *,
        terminate_process: Any,
    ) -> dict[str, Any]:
        path, task = self._read_delegation(delegation_path)
        metadata = dict(task.get("metadata") or {})
        pid = metadata.get("content_run_pid")
        terminate_process(
            int(pid) if isinstance(pid, int) else int(pid) if isinstance(pid, str) and pid.isdigit() else None
        )

        refreshed_task = self.storage.read_json(path) if path.exists() else task
        latest_content_run = refreshed_task.get("latest_content_run")
        if latest_content_run:
            task["latest_content_run"] = latest_content_run
            task["status"] = "partial" if not latest_content_run.get("video_path") else "completed"
        else:
            task["status"] = "failed"

        metadata.pop("content_run_pid", None)
        metadata["cancelled_at"] = datetime.now().astimezone().isoformat()
        task["metadata"] = metadata
        path.write_text(json.dumps(task, indent=2, ensure_ascii=False), encoding="utf-8")
        return {"ok": True, "status": task["status"], "latest_content_run": task.get("latest_content_run")}

    def prepare_video_call_invite_for_delegation(
        self,
        delegation_path: Path | str,
        *,
        send_sms: Any,
    ) -> dict[str, Any] | None:
        path, task = self._read_delegation(delegation_path)
        if str(task.get("channel") or "").strip() != "video_call":
            return None
        if not task.get("scheduled_for"):
            return None

        counterpart = dict(task.get("counterpart") or {})
        metadata = dict(task.get("metadata") or {})
        video_meeting_setup = str(metadata.get("video_meeting_setup") or "external_guest").strip().lower()

        latest_video_session = dict(metadata.get("latest_video_session") or {})
        if video_meeting_setup == "local_self_test":
            latest_video_session.update(
                {
                    "title": str(task.get("title") or task.get("goal") or "Twin video call").strip(),
                    "status": "scheduled",
                    "counterpart_name": "Local Self-Test",
                    "counterpart_phone": "",
                    "invite_delivery_status": "local_only",
                    "invite_delivery_note": "This meeting is configured for local self-test only. No external invite will be sent.",
                }
            )
            metadata["latest_video_session"] = latest_video_session
            task["metadata"] = metadata
            path.write_text(json.dumps(task, indent=2, ensure_ascii=False), encoding="utf-8")
            return {
                "video_session_preview": latest_video_session,
                "delivery": {"sid": None, "status": "local_only", "to": ""},
            }

        counterpart_phone = str(counterpart.get("phone_number") or "").strip()
        counterpart_name = str(counterpart.get("name") or "Guest").strip() or "Guest"
        if not counterpart_phone:
            return None

        profile = self.get_profile().to_dict()
        principal_name = str(task.get("principal_name") or profile.get("name") or "Twin")
        prep_body = build_video_prep_message(
            counterpart_name=counterpart_name,
            principal_name=principal_name,
            scheduled_for=task.get("scheduled_for"),
            calling_identity_mode=str(profile.get("calling_identity_mode") or "personal_twin"),
            language=str(profile.get("language") or "tr-TR"),
        )

        latest_video_session.update(
            {
                "title": str(task.get("title") or task.get("goal") or "Twin video call").strip(),
                "status": "scheduled",
                "counterpart_name": counterpart_name,
                "counterpart_phone": counterpart_phone,
                "invite_body": prep_body,
            }
        )

        delivery: dict[str, Any] | None = None
        sent_note = "A preparation message was sent. The meeting link will be shared around the scheduled time."
        failed_note = "The preparation message could not be sent. The meeting is still scheduled and the link message will be retried at the scheduled time."
        try:
            delivery = send_sms(to_number=counterpart_phone, body=prep_body)
            latest_video_session["invite_delivery_status"] = "prep_sent"
            latest_video_session["invite_sent_at"] = datetime.now().astimezone().isoformat()
            latest_video_session["invite_message_sid"] = delivery.get("sid")
            latest_video_session["invite_delivery_note"] = sent_note
        except RuntimeError:
            latest_video_session["invite_delivery_status"] = "prep_failed"
            latest_video_session["invite_delivery_note"] = failed_note

        metadata["profile_language"] = str(profile.get("language") or "tr-TR")
        metadata["calling_identity_mode"] = str(profile.get("calling_identity_mode") or "personal_twin")
        metadata["latest_video_session"] = latest_video_session
        task["metadata"] = metadata
        path.write_text(json.dumps(task, indent=2, ensure_ascii=False), encoding="utf-8")
        return {
            "video_session_preview": latest_video_session,
            "delivery": {
                "sid": delivery.get("sid") if delivery else None,
                "status": latest_video_session.get("invite_delivery_status"),
                "to": counterpart_phone,
            },
        }

    def run_workspace_maintenance_tick(
        self,
        *,
        tasks: list[dict[str, Any]],
        execute_delegation: Any,
        storage_reader_module: Any,
        runs_dir: Path,
        run_heygen_json: Any,
        run_heygen_plain: Any,
        extract_timeout_video_id: Any,
        humanize_provider_error: Any,
        persist_task: Any,
        tick_cron_scheduler: Any,
    ) -> None:
        recover_due_delegations(
            tasks=tasks,
            execute_delegation=execute_delegation,
        )
        sync_pending_heygen_videos(
            tasks=tasks,
            storage_reader_module=storage_reader_module,
            runs_dir=runs_dir,
            run_heygen_json=run_heygen_json,
            run_heygen_plain=run_heygen_plain,
            extract_timeout_video_id=extract_timeout_video_id,
            humanize_provider_error=humanize_provider_error,
            persist_task=persist_task,
        )
        tick_cron_scheduler()

    def execute_scheduled_delegation(
        self,
        *,
        delegation_path: Path | str,
        source: str = "cron",
        remove_cron_job: Any,
        persist_task: Any,
        call_run: Any,
        run_video_call: Any,
        spawn_content_run_process: Any,
        spawn_call_log_process: Any,
        record_failure: Any,
    ) -> dict[str, Any]:
        return runtime_execute_scheduled_delegation(
            delegation_path=Path(delegation_path).expanduser().resolve(),
            source=source,
            remove_cron_job=remove_cron_job,
            persist_task=persist_task,
            call_run=call_run,
            run_video_call=run_video_call,
            spawn_content_run_process=spawn_content_run_process,
            spawn_call_log_process=spawn_call_log_process,
            record_failure=record_failure,
        )

    def apply_schedule_to_delegation(
        self,
        *,
        delegation_path: Path | str,
        scheduled_for: str | None,
        title: str,
        channel: str,
        schedule_job: Any,
        remove_job: Any,
    ) -> dict[str, Any]:
        path, task = self._read_delegation(delegation_path)
        remove_job(task)
        if not scheduled_for:
            cleared = self.clear_scheduled_delegation(
                delegation_path=path,
                remove_job=lambda _task: None,
            )
            return {
                "delegation_path": str(path),
                "delegation": cleared,
            }

        schedule_result = schedule_job(
            delegation_path=str(path),
            scheduled_for=scheduled_for,
            title=title,
            channel=channel,
        )
        metadata = dict(task.get("metadata") or {})
        metadata.update(
            {
                "scheduled_job_id": schedule_result.get("job_id"),
                "scheduled_job_next_run_at": schedule_result.get("next_run_at"),
                "scheduled_job_script": schedule_result.get("script_path"),
            }
        )
        task["metadata"] = metadata
        path.write_text(json.dumps(task, indent=2, ensure_ascii=False), encoding="utf-8")
        return {
            "delegation_path": str(path),
            "delegation": task,
            "scheduled_job_id": schedule_result.get("job_id"),
            "scheduled_job_next_run_at": schedule_result.get("next_run_at"),
        }

    def clear_scheduled_delegation(
        self,
        *,
        delegation_path: Path | str,
        remove_job: Any,
    ) -> dict[str, Any]:
        path, task = self._read_delegation(delegation_path)
        remove_job(task)
        metadata = dict(task.get("metadata") or {})
        metadata.pop("scheduled_job_id", None)
        metadata.pop("scheduled_job_next_run_at", None)
        metadata.pop("scheduled_job_script", None)
        task["metadata"] = metadata
        path.write_text(json.dumps(task, indent=2, ensure_ascii=False), encoding="utf-8")
        return task
