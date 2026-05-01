from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any, Callable


def _format_scheduled_for(value: str | None) -> str | None:
    if not value:
        return None
    try:
        scheduled = datetime.fromisoformat(str(value).replace("Z", "+00:00")).astimezone()
    except ValueError:
        return None
    return scheduled.strftime("%Y-%m-%d %H:%M %Z")


def _is_turkish_language(value: str | None) -> bool:
    return str(value or "").strip().lower().startswith("tr")


def _identity_subject(*, principal_name: str, calling_identity_mode: str, is_tr: bool) -> str:
    mode = str(calling_identity_mode or "personal_twin").strip().lower()
    if mode == "assistant_on_behalf":
        return f"{principal_name} adına" if is_tr else f"on behalf of {principal_name}"
    return principal_name


def build_video_prep_message(
    *,
    counterpart_name: str,
    principal_name: str,
    scheduled_for: str | None = None,
    calling_identity_mode: str = "personal_twin",
    language: str = "tr-TR",
) -> str:
    is_tr = _is_turkish_language(language)
    subject = _identity_subject(
        principal_name=principal_name,
        calling_identity_mode=calling_identity_mode,
        is_tr=is_tr,
    )
    scheduled_label = _format_scheduled_for(scheduled_for)
    greeting_name = counterpart_name.strip() or ("orada" if is_tr else "there")
    if is_tr:
        if scheduled_label:
            return (
                f"Merhaba {greeting_name}, {subject} kısa bir video görüşme planladı. "
                f"Görüşme bağlantısını {scheduled_label} civarında bu numaraya göndereceğim."
            )
        return (
            f"Merhaba {greeting_name}, {subject} kısa bir video görüşme planladı. "
            f"Görüşme bağlantısını saat yaklaşınca bu numaraya göndereceğim."
        )
    if scheduled_label:
        return (
            f"Hi {greeting_name}, {subject} scheduled a short video meeting. "
            f"I'll send the meeting link to this number around {scheduled_label}."
        )
    return (
        f"Hi {greeting_name}, {subject} scheduled a short video meeting. "
        f"I'll send the meeting link to this number shortly before the meeting."
    )


def build_video_invite_message(
    *,
    counterpart_name: str,
    principal_name: str,
    title: str,
    join_url: str,
    scheduled_for: str | None = None,
    calling_identity_mode: str = "personal_twin",
    language: str = "tr-TR",
) -> str:
    is_tr = _is_turkish_language(language)
    scheduled_label = _format_scheduled_for(scheduled_for)
    greeting_name = counterpart_name.strip() or ("orada" if is_tr else "there")
    title_line = title.strip() or "our Twin meeting"
    subject = _identity_subject(
        principal_name=principal_name,
        calling_identity_mode=calling_identity_mode,
        is_tr=is_tr,
    )
    if is_tr:
        if scheduled_label:
            return (
                f"Merhaba {greeting_name}, {subject} için planlanan video görüşme bağlantısı hazır. "
                f"{scheduled_label} görüşmesi: {join_url}"
            )
        return (
            f"Merhaba {greeting_name}, {subject} için video görüşme bağlantısı hazır. "
            f"{title_line}: {join_url}"
        )
    if scheduled_label:
        return (
            f"Hi {greeting_name}, the video meeting link for {subject} is ready for {scheduled_label}. "
            f"{title_line}: {join_url}"
        )
    return (
        f"Hi {greeting_name}, the video meeting link for {subject} is ready. "
        f"{title_line}: {join_url}"
    )


def build_video_invite_delivery_warning(*, language: str = "tr-TR") -> str:
    return "The video meeting is ready, but the link message could not be delivered. The link is still available in the workspace."


def execute_video_call_delegation(
    *,
    delegation_path: str | Path,
    task: dict[str, Any],
    source: str,
    persist_task: Callable[[str | Path, dict[str, Any]], None],
    create_video_session: Callable[..., dict[str, Any]],
    start_video_session: Callable[..., dict[str, Any]],
    send_invite_sms: Callable[..., dict[str, Any]],
    now_iso: Callable[[], str],
) -> dict[str, Any]:
    path = Path(delegation_path).resolve()
    counterpart = dict(task.get("counterpart") or {})
    video_meeting_setup = str(((task.get("metadata") or {}).get("video_meeting_setup") or "external_guest")).strip().lower()
    counterpart_name = str(counterpart.get("name") or "Guest").strip() or "Guest"
    counterpart_phone = str(counterpart.get("phone_number") or "").strip()
    if video_meeting_setup != "local_self_test" and not counterpart_phone:
        raise RuntimeError("Twin couldn't send the video meeting details because this contact has no phone number.")

    title = str(task.get("title") or task.get("goal") or "Twin video call").strip()
    goal = str(task.get("goal") or "").strip()
    profile_language = str((task.get("metadata") or {}).get("profile_language") or "tr-TR")
    calling_identity_mode = str((task.get("metadata") or {}).get("calling_identity_mode") or "personal_twin")
    session = create_video_session(
        title=title,
        goal=goal,
        counterpart_name=counterpart_name,
        workspace_notes=[str(note).strip() for note in (task.get("context_notes") or []) if str(note).strip()],
    )
    session_id = str(session.get("video_session_id") or "").strip()
    if not session_id:
        raise RuntimeError("Twin couldn't prepare the video meeting. Please try again.")

    started = start_video_session(video_session_id=session_id)
    join_url = str(started.get("join_url") or session.get("join_url") or "").strip()
    if not join_url:
        raise RuntimeError("Twin couldn't get a join link for the video meeting. Please try again.")

    metadata = dict(task.get("metadata") or {})
    latest_video_session = {
        "video_session_id": session_id,
        "title": str(started.get("title") or title),
        "status": str(started.get("status") or session.get("status") or "active"),
        "join_url": join_url,
        "counterpart_name": counterpart_name,
        "counterpart_phone": counterpart_phone,
        "started_at": now_iso(),
        "source": source,
        "invite_delivery_status": "pending",
    }
    metadata["latest_video_session"] = latest_video_session
    task["metadata"] = metadata
    task["status"] = "running"
    persist_task(path, task)

    delivery: dict[str, Any] | None = None
    final_status = "completed"
    if video_meeting_setup == "local_self_test":
        latest_video_session["invite_delivery_status"] = "local_only"
        latest_video_session["invite_delivery_note"] = "This meeting is running in local self-test mode. No external invite was sent."
        user_message = "Local self-test meeting started successfully."
    else:
        sms_body = build_video_invite_message(
            counterpart_name=counterpart_name,
            principal_name=str(task.get("principal_name") or "Twin"),
            title=title,
            join_url=join_url,
            scheduled_for=task.get("scheduled_for"),
            calling_identity_mode=calling_identity_mode,
            language=profile_language,
        )
        user_message = "Video meeting started successfully."
        try:
            delivery = send_invite_sms(
                to_number=counterpart_phone,
                body=sms_body,
            )
            latest_video_session["invite_delivery_status"] = str(delivery.get("status") or "queued")
            latest_video_session["invite_sent_at"] = now_iso()
            latest_video_session["invite_message_sid"] = delivery.get("sid")
            latest_video_session["invite_body"] = sms_body
            user_message = "Video meeting started and the link message was sent successfully."
        except RuntimeError:
            latest_video_session["invite_delivery_status"] = "invite_failed"
            latest_video_session["invite_delivery_error"] = build_video_invite_delivery_warning(language=profile_language)
            latest_video_session["invite_sent_at"] = now_iso()
            latest_video_session["invite_body"] = sms_body
            final_status = "partial"
            user_message = build_video_invite_delivery_warning(language=profile_language)
    metadata["latest_video_session"] = latest_video_session
    metadata.pop("last_error", None)
    metadata.pop("last_error_raw", None)
    metadata.pop("last_error_source", None)
    task["metadata"] = metadata
    task["status"] = final_status
    persist_task(path, task)

    return {
        "status": final_status,
        "channel": "video_call",
        "source": source,
        "user_message": user_message,
        "video_session": latest_video_session,
        "delivery": {
            "sid": delivery.get("sid") if delivery else None,
            "status": delivery.get("status") if delivery else "failed",
            "to": delivery.get("to") if delivery else counterpart_phone,
            "from": delivery.get("from") if delivery else None,
        },
    }
