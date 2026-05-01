from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def _safe_read_json(path: Path) -> dict[str, Any] | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def _read_recent_json(dir_path: Path, pattern: str, limit: int) -> list[dict[str, Any]]:
    if not dir_path.exists():
        return []
    items: list[dict[str, Any]] = []
    for path in sorted(dir_path.glob(pattern), reverse=True):
        payload = _safe_read_json(path)
        if not payload:
            continue
        payload["_path"] = str(path)
        items.append(payload)
        if len(items) >= limit:
            break
    return items


def build_realtime_prompt(profile: dict[str, Any]) -> str:
    name = profile.get("name", "Twin")
    persona = str(profile.get("persona") or "").strip()
    profession = str(profile.get("profession") or "").strip()
    social_tone = str(profile.get("social_tone") or "").strip()
    interaction_style = str(profile.get("interaction_style") or "").strip()
    domain_familiarity = [str(item).strip() for item in (profile.get("domain_familiarity") or []) if str(item).strip()]
    boundary_rules = [str(item).strip() for item in (profile.get("boundary_rules") or []) if str(item).strip()]
    do_not_say = [str(item).strip() for item in (profile.get("do_not_say") or []) if str(item).strip()]
    first_message = str(profile.get("first_message") or "").strip()
    language = str(profile.get("language") or "tr-TR")
    identity_mode = str(profile.get("calling_identity_mode") or "personal_twin")
    style_profile = profile.get("style_profile") or {}
    style_summary = str(style_profile.get("summary") or "").strip()
    tone = ", ".join(style_profile.get("tone") or [])

    identity_block = (
        f"- Speak in first person as {name}.\n"
        if identity_mode != "assistant_on_behalf"
        else f"- Speak on behalf of {name}, but do not claim to literally be {name}.\n"
    )

    first_message_block = f"- Preferred opener: {first_message}\n" if first_message else ""
    language_lower = language.lower()
    if language_lower.startswith("tr"):
        conversation_style_block = (
            "- Speak Turkish naturally and consistently.\n"
            "- Address the other person as 'siz'; do not call them 'sen'.\n"
            "- Be warm, natural, and socially fluent without sounding like a customer-support bot.\n"
            "- After simple greetings or 'nasılsınız', respond briefly and naturally, then continue with a relevant follow-up.\n"
            "- React directly to what you hear; do not jump to canned help phrases.\n"
            "- Do not say generic assistant lines such as 'Size nasıl yardımcı olabilirim?', 'Ne hakkında konuşmak istersiniz?', or 'Sizi neşelendirmek için buradayım.' unless the user explicitly asks for help in that form.\n"
            "- Prefer short, human replies like 'Ben de iyiyim, teşekkür ederim.' or 'İyi gidiyor, teşekkür ederim.' before continuing.\n"
        )
    elif language_lower.startswith("en"):
        conversation_style_block = (
            "- Speak English naturally and consistently.\n"
            "- Be warm, natural, and socially fluent without sounding like a customer-support bot.\n"
            "- After simple greetings or 'How are you?', respond briefly and naturally, then continue with a relevant follow-up.\n"
            "- React directly to what you hear; do not jump to canned help phrases.\n"
            "- Do not say generic assistant lines such as 'How can I help you?', 'What would you like to talk about?', or 'I'm here to cheer you up.' unless the user explicitly asks for help in that form.\n"
            "- Prefer short, human replies like 'I'm good, thank you.' or 'Doing well, thanks.' before continuing.\n"
            "- Keep the tone conversational and person-like rather than formal support language.\n"
        )
    else:
        conversation_style_block = (
            "- Speak naturally in the configured language and mirror the user's level of formality.\n"
            "- React directly to what you hear instead of switching into generic assistant phrasing.\n"
            "- Avoid broad helper lines like 'How can I help you?' unless the user explicitly asks for help.\n"
        )

    structured_identity_block = ""
    if profession:
        structured_identity_block += f"- Internal role/background: {profession}. Do not mention this unless the user explicitly asks.\n"
    if social_tone:
        structured_identity_block += f"- Social tone: {social_tone}.\n"
    if interaction_style:
        structured_identity_block += f"- Interaction style: {interaction_style}.\n"
    if domain_familiarity:
        structured_identity_block += f"- Familiar domains: {', '.join(domain_familiarity)}.\n"
    if boundary_rules:
        structured_identity_block += f"- Boundary rules: {'; '.join(boundary_rules)}.\n"
    if do_not_say:
        structured_identity_block += f"- Avoid saying/doing: {'; '.join(do_not_say)}.\n"
    if persona:
        structured_identity_block += f"- Additional persona notes: {persona}\n"

    return (
        f"You are the realtime Twin agent for {name}.\n"
        f"- Conversation language: {language}\n"
        f"{identity_block}"
        f"{first_message_block}"
        f"{structured_identity_block}"
        f"- Do not explain that you are a bot, agent, or digital twin unless explicitly required.\n"
        f"- Keep answers short, natural, and suitable for spoken conversation.\n"
        f"- If the other person interrupts, stop extending the old answer and adapt to the new input.\n"
        f"- Avoid long monologues unless the user clearly asks for one.\n"
        f"{conversation_style_block}"
        f"- If the user opens with a simple greeting or small talk, respond naturally in the same language instead of asking abstract context questions.\n"
        f"- Do not ask broad questions like 'What should we talk about?' unless the session has no goal at all.\n"
        f"- Style summary: {style_summary or social_tone or persona or 'Clear, calm, controlled.'}\n"
        f"- Tone markers: {tone or 'clear, calm'}\n"
    )


def augment_realtime_context(
    base_context: dict[str, Any],
    *,
    title: str,
    goal: str,
    counterpart_name: str,
    workspace_notes: list[str] | None = None,
) -> dict[str, Any]:
    context = json.loads(json.dumps(base_context))
    prompt = str(context.get("prompt") or "").rstrip()
    session_notes = [note.strip() for note in (workspace_notes or []) if str(note).strip()]
    session_block = [
        "Current realtime session:",
        f"- Session title: {title}",
        f"- Counterpart: {counterpart_name}",
        f"- Primary goal: {goal}",
        "- Stay grounded in this session goal unless the user clearly changes topic.",
        "- If the user starts with a greeting, greet back briefly and then continue naturally within this goal.",
        "- Keep the flow conversational; do not switch into generic assistant or facilitator language after the greeting.",
    ]
    if session_notes:
        session_block.append(f"- Workspace notes: {' | '.join(session_notes)}")
    context["prompt"] = f"{prompt}\n" + "\n".join(session_block) + "\n"
    context["session_title"] = title
    context["session_goal"] = goal
    context["counterpart_name"] = counterpart_name
    if session_notes:
        existing_notes = list(context.get("workspace_notes") or [])
        context["workspace_notes"] = existing_notes + session_notes
    return context


def build_realtime_context(*, profile_slug: str, profile_path: str | Path) -> dict[str, Any]:
    profile_file = Path(profile_path).expanduser().resolve()
    profile = _safe_read_json(profile_file) or {}
    root = profile_file.parents[2]
    delegations_dir = root / "delegations" / profile_slug

    recent_delegations = _read_recent_json(delegations_dir, "*/delegation.json", limit=5)
    recent_calls: list[dict[str, Any]] = []
    for delegation in recent_delegations:
        delegation_path = Path(str(delegation.get("_path", "")))
        calls_dir = delegation_path.parent / "calls"
        recent_calls.extend(_read_recent_json(calls_dir, "*.json", limit=2))
        if len(recent_calls) >= 5:
            recent_calls = recent_calls[:5]
            break

    workspace_notes: list[str] = []
    for delegation in recent_delegations[:5]:
        goal = str(delegation.get("goal") or "").strip()
        counterpart = (delegation.get("counterpart") or {}).get("name")
        if goal:
            workspace_notes.append(
                f"Recent delegation with {counterpart or 'unknown counterpart'}: {goal}"
            )

    return {
        "prompt": build_realtime_prompt(profile),
        "profile_name": profile.get("name"),
        "language": profile.get("language"),
        "preferred_opener": profile.get("first_message"),
        "workspace_notes": workspace_notes,
        "recent_delegations": recent_delegations,
        "recent_calls": recent_calls,
    }
