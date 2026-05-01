from __future__ import annotations

import json
import time
import traceback
from datetime import datetime
from pathlib import Path
from typing import Any, Callable


def update_json(path: str | Path, patch: dict[str, Any]) -> None:
    target = Path(path)
    payload = json.loads(target.read_text(encoding="utf-8"))
    payload.update(patch)
    target.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")


def read_call_run_context(call_run_path: str | Path | None) -> dict[str, Any]:
    if not call_run_path:
        return {}
    path = Path(call_run_path)
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def summarize_transcript(transcript: list[dict[str, Any]]) -> str:
    snippets: list[str] = []
    for turn in transcript:
        role = str(turn.get("role") or "unknown").strip()
        message = str(turn.get("message") or "").strip()
        if not message:
            continue
        snippets.append(f"{role}: {message}")
        if len(snippets) >= 6:
            break
    return "\n".join(snippets)


def build_turkish_summary(payload: dict[str, Any]) -> str:
    transcript = payload.get("transcript") or []
    agent_messages = [
        str(turn.get("message") or "").strip()
        for turn in transcript
        if str(turn.get("role") or "").strip() == "agent" and str(turn.get("message") or "").strip()
    ]
    user_messages = [
        str(turn.get("message") or "").strip()
        for turn in transcript
        if str(turn.get("role") or "").strip() == "user" and str(turn.get("message") or "").strip()
    ]

    parts: list[str] = []
    if agent_messages:
        parts.append(f'Twin gorusmeye "{agent_messages[0]}" diyerek basladi.')
    if len(agent_messages) > 1:
        parts.append(f'Ardindan amacini "{agent_messages[1]}" diyerek netlestirdi.')
    if user_messages:
        parts.append(f'Karsi tarafin ilk yaniti: "{user_messages[0]}".')

    analysis = payload.get("analysis") or {}
    success = str(analysis.get("call_successful") or "").strip().lower()
    if success == "success":
        parts.append("Cagri basarili olarak isaretlendi.")
    elif success == "partial":
        parts.append("Cagri kismi basari olarak isaretlendi.")
    elif success == "failure":
        parts.append("Cagri basarisiz olarak isaretlendi.")

    return " ".join(parts) or "Twin cagiriyi tamamladi."


def detect_call_reason(payload: dict[str, Any], call_run_path: str | Path | None = None) -> str | None:
    context = read_call_run_context(call_run_path)
    connection_status = str(context.get("call_connection_status") or "").strip().lower()
    connection_reason = str(context.get("call_connection_reason") or "").strip().lower()
    transcript = payload.get("transcript") or []
    agent_messages = [
        str(turn.get("message") or "").strip()
        for turn in transcript
        if str(turn.get("role") or "").strip() == "agent" and str(turn.get("message") or "").strip()
    ]
    user_messages = [
        str(turn.get("message") or "").strip()
        for turn in transcript
        if str(turn.get("role") or "").strip() == "user" and str(turn.get("message") or "").strip()
    ]

    if connection_status in {"no-answer", "no_answer"} or connection_reason in {"no_answer", "no_answer_timeout"}:
        return "no_answer"

    status = str(payload.get("status") or "").strip().lower()
    if status in {"done", "failed"} and agent_messages and not user_messages:
        return "silence_after_answer"

    analysis = payload.get("analysis") or {}
    call_successful = str(analysis.get("call_successful") or "").strip().lower()
    if status == "failed" and call_successful != "success" and agent_messages and not user_messages:
        return "silence_after_answer"

    return None


def call_reason_prefix(reason: str | None, *, summary_language: str) -> str | None:
    if not reason:
        return None
    if summary_language == "tr":
        return {
            "no_answer": "30 saniye calmasina ragmen kimse acmadi.",
            "silence_after_answer": "Gorusme acildi ama ardindan sessizlik oldu.",
        }.get(reason)
    return {
        "no_answer": "No answer after 30 seconds of ringing.",
        "silence_after_answer": "The call connected, but then went silent.",
    }.get(reason)


def normalize_summary_text(summary: str, payload: dict[str, Any], *, call_reason: str | None, summary_language: str) -> str:
    reason_prefix = call_reason_prefix(call_reason, summary_language=summary_language)
    if summary_language == "tr":
        transcript = payload.get("transcript") or []
        if reason_prefix and call_reason == "no_answer":
            return reason_prefix
        base = build_turkish_summary(payload)
        if reason_prefix and not transcript:
            return reason_prefix
        if reason_prefix:
            return f"{reason_prefix} {base}".strip() if base else reason_prefix
        return base

    normalized = " ".join(summary.split())
    replacements = {
        "The agent": "Twin",
        "the agent": "Twin",
        "Agent": "Twin",
        "agent": "twin",
    }
    for source, target in replacements.items():
        normalized = normalized.replace(source, target)
    if reason_prefix:
        if not normalized or normalized == "Call completed.":
            return reason_prefix
        return f"{reason_prefix} {normalized}".strip()
    return normalized


def extract_summary(payload: dict[str, Any], *, call_run_path: str | Path | None = None, summary_language: str) -> str:
    call_reason = detect_call_reason(payload, call_run_path)
    analysis = payload.get("analysis") or {}
    candidates = [
        analysis.get("transcript_summary"),
        analysis.get("summary"),
        analysis.get("call_summary"),
        payload.get("transcript_summary"),
        payload.get("call_summary_title"),
    ]
    for candidate in candidates:
        if isinstance(candidate, str) and candidate.strip():
            return normalize_summary_text(candidate.strip(), payload, call_reason=call_reason, summary_language=summary_language)
    transcript = payload.get("transcript") or []
    fallback = summarize_transcript(transcript)
    return normalize_summary_text(fallback or "Call completed.", payload, call_reason=call_reason, summary_language=summary_language)


def extract_next_steps(payload: dict[str, Any]) -> list[str]:
    analysis = payload.get("analysis") or {}
    candidates = [
        analysis.get("next_steps"),
        analysis.get("action_items"),
        payload.get("next_steps"),
    ]
    for candidate in candidates:
        if isinstance(candidate, list):
            steps = [str(item).strip() for item in candidate if str(item).strip()]
            if steps:
                return steps
    return []


def extract_pending_approvals(payload: dict[str, Any], *, summary_language: str) -> list[str]:
    analysis = payload.get("analysis") or {}
    candidates = [
        analysis.get("pending_approvals"),
        analysis.get("approvals_needed"),
        payload.get("pending_approvals"),
    ]
    for candidate in candidates:
        if isinstance(candidate, list):
            items = [str(item).strip() for item in candidate if str(item).strip()]
            if items:
                return items
    return []


def extract_post_call_followups(payload: dict[str, Any], *, summary_language: str) -> list[str]:
    analysis = payload.get("analysis") or {}
    candidates = [
        analysis.get("post_call_followups"),
        analysis.get("follow_up_actions"),
        payload.get("post_call_followups"),
    ]
    for candidate in candidates:
        if isinstance(candidate, list):
            items = [str(item).strip() for item in candidate if str(item).strip()]
            if items:
                return items

    transcript = payload.get("transcript") or []
    agent_messages = [
        str(turn.get("message") or "").strip().lower()
        for turn in transcript
        if str(turn.get("role") or "").strip() == "agent" and str(turn.get("message") or "").strip()
    ]
    if not agent_messages:
        return []

    follow_up_markers = (
        "size döneceğim",
        "size geri dönüş yapacağım",
        "geri dönüş yapacağım",
        "geri donus yapacagim",
        "geri döneceğim",
        "teyit edip döneceğim",
        "netleştirip döneceğim",
        "tekrar arayacağım",
        "sizi tekrar arayacağım",
        "sizi sonra arayacağım",
        "görüşmeden sonra paylaşacağım",
        "i will get back to you",
        "i'll get back to you",
        "i will call you back",
        "i'll call you back",
        "i will confirm that",
        "i'll confirm that",
    )
    if any(marker in message for marker in follow_up_markers for message in agent_messages):
        if summary_language == "tr":
            return ["Twin görüşme sırasında takip gerektiren bir nokta bıraktı; geri dönüş bekleniyor."]
        return ["Twin left a follow-up point during the call; a return action is pending."]
    return []


def extract_pending_actions(payload: dict[str, Any], *, summary_language: str) -> list[str]:
    analysis = payload.get("analysis") or {}
    candidates = [
        analysis.get("pending_actions"),
        analysis.get("action_items"),
        payload.get("pending_actions"),
    ]
    for candidate in candidates:
        if isinstance(candidate, list):
            items = [str(item).strip() for item in candidate if str(item).strip()]
            if items:
                return items
    next_steps = extract_next_steps(payload)
    if next_steps:
        return next_steps
    return []


def extract_outcome(payload: dict[str, Any], *, call_run_path: str | Path | None = None) -> tuple[str, str]:
    status = str(payload.get("status") or "").strip().lower()
    analysis = payload.get("analysis") or {}
    raw_success = analysis.get("call_successful", payload.get("call_successful"))
    success_value = str(raw_success).strip().lower() if raw_success is not None else ""
    call_reason = detect_call_reason(payload, call_run_path)

    if status == "failed" or success_value == "failure" or call_reason == "no_answer":
        return "failed", "failed"
    if call_reason == "silence_after_answer":
        transcript = payload.get("transcript") or []
        user_messages = [
            str(turn.get("message") or "").strip()
            for turn in transcript
            if str(turn.get("role") or "").strip() == "user" and str(turn.get("message") or "").strip()
        ]
        if user_messages:
            return "completed", "partial"
    if success_value in {"success", "partial"}:
        return "completed", success_value
    if status == "done":
        return "completed", "success"
    return "completed", "partial"


def write_transcript_file(call_run_path: str | Path, payload: dict[str, Any]) -> Path:
    target = Path(call_run_path)
    lines: list[str] = []
    for turn in payload.get("transcript") or []:
        role = str(turn.get("role") or "unknown").strip()
        message = str(turn.get("message") or "").strip()
        if message:
            lines.append(f"{role}: {message}")
    transcript = "\n".join(lines)
    transcript_path = target.with_name(f"{target.stem}_transcript.txt")
    transcript_path.write_text(transcript or "Transcript unavailable.", encoding="utf-8")
    return transcript_path


def wait_for_call_connection_and_mark(
    *,
    call_run_path: str,
    call_sid: str,
    fetch_twilio_call: Callable[[str], dict[str, Any]],
    fetch_twilio_call_events: Callable[[str], list[dict[str, Any]]],
    timeout_seconds: int = 35,
    poll_interval_seconds: int = 5,
) -> dict[str, Any] | None:
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        payload = fetch_twilio_call(call_sid)
        status = str(payload.get("status") or "").strip().lower()
        update_json(
            call_run_path,
            {
                "call_connection_status": status or "unknown",
                "call_connection_checked_at": datetime.now().astimezone().isoformat(),
            },
        )
        if status in {"in-progress", "completed"}:
            return payload
        if status in {"busy", "failed", "canceled", "no-answer"}:
            sip_response_code = None
            try:
                events = fetch_twilio_call_events(call_sid)
                for event in reversed(events):
                    params = ((event.get("request") or {}).get("parameters") or {})
                    code = str(params.get("sip_response_code") or "").strip()
                    if code:
                        sip_response_code = code
                        break
            except Exception:
                sip_response_code = None
            update_json(
                call_run_path,
                {
                    "call_connection_reason": status,
                    "sip_response_code": sip_response_code,
                    "call_connection_final_at": datetime.now().astimezone().isoformat(),
                },
            )
            return payload
        time.sleep(poll_interval_seconds)

    update_json(
        call_run_path,
        {
            "call_connection_status": "no-answer",
            "call_connection_reason": "no_answer_timeout",
            "call_connection_checked_at": datetime.now().astimezone().isoformat(),
            "call_connection_final_at": datetime.now().astimezone().isoformat(),
        },
    )
    return None


def wait_for_conversation_and_log(
    *,
    delegation_path: str,
    call_run_path: str,
    conversation_id: str,
    fetch_conversation: Callable[[str], dict[str, Any]],
    log_call: Callable[..., dict[str, Any]],
    summary_language: str,
    timeout_seconds: int = 900,
    poll_interval_seconds: int = 10,
) -> dict[str, Any] | None:
    update_json(call_run_path, {"auto_log_status": "waiting"})
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        payload = fetch_conversation(conversation_id)
        status = str(payload.get("status") or "").strip().lower()
        update_json(call_run_path, {"auto_log_status": status or "waiting"})
        if status in {"done", "failed"}:
            transcript_path = write_transcript_file(call_run_path, payload)
            final_status, outcome = extract_outcome(payload, call_run_path=call_run_path)
            call_context = read_call_run_context(call_run_path)
            call_reason = detect_call_reason(payload, call_run_path)
            notes = [
                f"conversation_id: {conversation_id}",
                f"conversation_status: {status}",
            ]
            if call_context.get("call_connection_status"):
                notes.append(f"call_connection_status: {call_context.get('call_connection_status')}")
            if call_context.get("call_connection_reason"):
                notes.append(f"call_connection_reason: {call_context.get('call_connection_reason')}")
            if call_reason:
                notes.append(f"call_reason: {call_reason}")
            metadata = payload.get("metadata") or {}
            duration = metadata.get("call_duration_secs")
            if duration is not None:
                notes.append(f"call_duration_secs: {duration}")
            result = log_call(
                delegation_path=delegation_path,
                status=final_status,
                summary=extract_summary(payload, call_run_path=call_run_path, summary_language=summary_language),
                outcome=outcome,
                next_steps=extract_next_steps(payload),
                pending_approvals=extract_pending_approvals(payload, summary_language=summary_language),
                post_call_followups=extract_post_call_followups(payload, summary_language=summary_language),
                pending_actions=extract_pending_actions(payload, summary_language=summary_language),
                notes=notes,
                transcript_path=transcript_path,
            )
            update_json(
                call_run_path,
                {
                    "auto_log_status": "logged",
                    "logged_call_path": result.get("call_path"),
                    "transcript_path": str(transcript_path),
                },
            )
            return result
        time.sleep(poll_interval_seconds)

    update_json(call_run_path, {"auto_log_status": "timeout"})
    raise RuntimeError(f"Conversation {conversation_id} did not reach a terminal state in time.")


def wait_for_call_connection_and_mark_safe(**kwargs: Any) -> None:
    call_run_path = str(kwargs["call_run_path"])
    try:
        wait_for_call_connection_and_mark(**kwargs)
    except Exception as exc:
        update_json(
            call_run_path,
            {
                "call_connection_watch_error": str(exc),
                "call_connection_watch_traceback": traceback.format_exc(),
            },
        )


def wait_for_conversation_and_log_safe(**kwargs: Any) -> None:
    call_run_path = str(kwargs["call_run_path"])
    try:
        wait_for_conversation_and_log(**kwargs)
    except Exception as exc:
        update_json(
            call_run_path,
            {
                "auto_log_status": "error",
                "auto_log_error": str(exc),
                "auto_log_traceback": traceback.format_exc(),
            },
        )
