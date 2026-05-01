from __future__ import annotations

from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any


@dataclass
class SourceDocument:
    path: str
    kind: str
    characters: int


@dataclass
class StyleProfile:
    summary: str
    tone: list[str]
    vocabulary_markers: list[str]
    structure_patterns: list[str]
    expertise_areas: list[str]
    do_not_mimic: list[str]
    sample_hooks: list[str]

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class TwinProfile:
    slug: str
    name: str
    photo_path: str
    voice_sample_path: str
    writing_samples: list[SourceDocument]
    style_profile: StyleProfile
    voice_id: str | None = None
    avatar_provider: str | None = None
    heygen_avatar_id: str | None = None
    heygen_avatar_group_id: str | None = None
    heygen_voice_id: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)
    # Agent settings — editable from Twin Workspace Identity page
    language: str = "tr-TR"
    voice_model: str = "eleven_turbo_v2_5"
    stability: float = 0.30
    similarity_boost: float = 0.86
    speed: float = 0.94
    persona: str = ""
    first_message: str = ""
    calling_identity_mode: str = "personal_twin"
    default_video_orientation: str = "portrait"

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["style_profile"] = self.style_profile.to_dict()
        return payload

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "TwinProfile":
        return cls(
            slug=payload["slug"],
            name=payload["name"],
            photo_path=payload["photo_path"],
            voice_sample_path=payload["voice_sample_path"],
            writing_samples=[SourceDocument(**doc) for doc in payload.get("writing_samples", [])],
            style_profile=StyleProfile(**payload["style_profile"]),
            voice_id=payload.get("voice_id"),
            avatar_provider=payload.get("avatar_provider"),
            heygen_avatar_id=payload.get("heygen_avatar_id"),
            heygen_avatar_group_id=payload.get("heygen_avatar_group_id"),
            heygen_voice_id=payload.get("heygen_voice_id"),
            metadata=payload.get("metadata", {}),
            language=payload.get("language", "tr-TR"),
            voice_model=payload.get("voice_model", "eleven_turbo_v2_5"),
            stability=float(payload.get("stability", 0.30)),
            similarity_boost=float(payload.get("similarity_boost", 0.86)),
            speed=float(payload.get("speed", 0.94)),
            persona=payload.get("persona", ""),
            first_message=payload.get("first_message", ""),
            calling_identity_mode=payload.get("calling_identity_mode", "personal_twin"),
            default_video_orientation=payload.get("default_video_orientation", "portrait"),
        )


@dataclass
class GenerationResult:
    run_id: str
    profile_path: str
    format: str
    brief: str
    script_path: str
    audio_path: str | None = None
    video_path: str | None = None
    manifest_path: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class DelegationContact:
    name: str
    organization: str | None = None
    role: str | None = None
    phone_number: str | None = None
    email: str | None = None
    relationship: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class DelegationAuthority:
    autonomous_actions: list[str] = field(default_factory=list)
    approval_required: list[str] = field(default_factory=list)
    forbidden_actions: list[str] = field(default_factory=list)
    spending_limit: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class DelegationTask:
    delegation_id: str
    profile_path: str
    principal_name: str
    title: str
    task_type: str
    channel: str
    goal: str
    scheduled_for: str | None
    counterpart: DelegationContact
    authority: DelegationAuthority
    context_notes: list[str] = field(default_factory=list)
    success_criteria: list[str] = field(default_factory=list)
    status: str = "planned"
    briefing_path: str | None = None
    latest_call_path: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["counterpart"] = self.counterpart.to_dict()
        payload["authority"] = self.authority.to_dict()
        return payload

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "DelegationTask":
        return cls(
            delegation_id=payload["delegation_id"],
            profile_path=payload["profile_path"],
            principal_name=payload["principal_name"],
            title=payload["title"],
            task_type=payload.get("task_type", "custom_request"),
            channel=payload["channel"],
            goal=payload["goal"],
            scheduled_for=payload.get("scheduled_for"),
            counterpart=DelegationContact(**payload["counterpart"]),
            authority=DelegationAuthority(**payload.get("authority", {})),
            context_notes=list(payload.get("context_notes", [])),
            success_criteria=list(payload.get("success_criteria", [])),
            status=payload.get("status", "planned"),
            briefing_path=payload.get("briefing_path"),
            latest_call_path=payload.get("latest_call_path"),
            metadata=payload.get("metadata", {}),
        )


@dataclass
class CallRecord:
    call_id: str
    delegation_id: str
    status: str
    summary: str
    outcome: str
    next_steps: list[str] = field(default_factory=list)
    pending_approvals: list[str] = field(default_factory=list)
    post_call_followups: list[str] = field(default_factory=list)
    pending_actions: list[str] = field(default_factory=list)
    transcript_path: str | None = None
    notes: list[str] = field(default_factory=list)
    created_at: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "CallRecord":
        return cls(
            call_id=payload["call_id"],
            delegation_id=payload["delegation_id"],
            status=payload["status"],
            summary=payload["summary"],
            outcome=payload["outcome"],
            next_steps=list(payload.get("next_steps", [])),
            pending_approvals=list(payload.get("pending_approvals", [])),
            post_call_followups=list(payload.get("post_call_followups", [])),
            pending_actions=list(payload.get("pending_actions", [])),
            transcript_path=payload.get("transcript_path"),
            notes=list(payload.get("notes", [])),
            created_at=payload.get("created_at"),
        )


def ensure_path(value: str | Path) -> Path:
    return value if isinstance(value, Path) else Path(value)
