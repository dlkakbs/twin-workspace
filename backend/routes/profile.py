from fastapi import APIRouter, HTTPException, File, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from pathlib import Path
import shutil

from config import HERMES_ROOT
from env_utils import merged_runtime_env, twin_workspace_api, twin_workspace_contract
from hermes_imports import ensure_hermes_import_path
from workspace_paths import profile_assets_dir, read_profile_payload

router = APIRouter(prefix="/profile", tags=["profile"])


def _profile_service():
    return twin_workspace_api()


def _load_heygen_settings():
    """Build the HeyGen-only settings needed for preview / avatar refresh."""
    ensure_hermes_import_path(HERMES_ROOT)
    from skills.twin.config import TwinSettings

    env = merged_runtime_env()
    contract = twin_workspace_contract()
    return TwinSettings(
        openai_api_key=env.get("OPENAI_API_KEY", ""),
        elevenlabs_api_key=env.get("ELEVENLABS_API_KEY", ""),
        heygen_api_key=env.get("HEYGEN_API_KEY"),
        avatar_provider="heygen",
        output_root=contract.output_root,
        heygen_api_base_url=env.get("HEYGEN_API_BASE_URL", "https://api.heygen.com"),
        heygen_upload_base_url=env.get("HEYGEN_UPLOAD_BASE_URL", "https://upload.heygen.com"),
        heygen_cli_path=env.get("HEYGEN_CLI_PATH", str(Path.home() / ".local" / "bin" / "heygen")),
        openai_base_url=env.get("OPENAI_BASE_URL", "https://api.openai.com/v1"),
        openai_profile_model=env.get("TWIN_OPENAI_PROFILE_MODEL", "gpt-4.1-mini"),
        openai_generation_model=env.get("TWIN_OPENAI_GENERATION_MODEL", "gpt-4.1-mini"),
        elevenlabs_base_url=env.get("ELEVENLABS_BASE_URL", "https://api.elevenlabs.io/v1"),
        elevenlabs_voice_model=env.get("TWIN_ELEVENLABS_VOICE_MODEL", "eleven_multilingual_sts_v2"),
        elevenlabs_tts_model=env.get("TWIN_ELEVENLABS_TTS_MODEL", "eleven_multilingual_v2"),
        heygen_poll_interval_seconds=float(env.get("TWIN_HEYGEN_POLL_INTERVAL", "5")),
        heygen_timeout_seconds=int(env.get("TWIN_HEYGEN_TIMEOUT", "300")),
    )


def _image_candidates() -> list[Path]:
    data = read_profile_payload()
    if not data:
        return []
    photo_path = Path(data.get("photo_path", "")) if data.get("photo_path") else None
    assets_dir = profile_assets_dir()
    candidates: list[Path] = []
    if assets_dir.exists():
        candidates.extend(sorted(assets_dir.glob("*.png")))
        candidates.extend(sorted(assets_dir.glob("*.jpg")))
        candidates.extend(sorted(assets_dir.glob("*.jpeg")))
    if photo_path:
        candidates = [path for path in candidates if path != photo_path]
    return candidates


def _load_profile_data() -> dict:
    try:
        return _profile_service().get_profile().to_dict()
    except Exception as exc:
        raise HTTPException(status_code=404, detail=f"Profile not found: {exc}")


def _profile_assets_dir() -> Path:
    return profile_assets_dir(ensure=True)


class ProfileUpdate(BaseModel):
    name: str | None = None
    language: str | None = None
    voice_model: str | None = None
    stability: float | None = None
    similarity_boost: float | None = None
    speed: float | None = None
    profession: str | None = None
    social_tone: str | None = None
    interaction_style: str | None = None
    domain_familiarity: list[str] | None = None
    boundary_rules: list[str] | None = None
    do_not_say: list[str] | None = None
    persona: str | None = None
    first_message: str | None = None
    calling_identity_mode: str | None = None
    avatar_provider: str | None = None
    heygen_avatar_id: str | None = None
    heygen_avatar_group_id: str | None = None
    heygen_voice_id: str | None = None
    default_video_orientation: str | None = None


@router.get("")
def get_profile():
    try:
        profile = _profile_service().get_profile().to_dict()
    except Exception:
        raise HTTPException(status_code=404, detail="Profile not found. Run 'skills.twin setup' first.")
    return profile


@router.get("/assets/{asset_kind}")
def get_profile_asset(asset_kind: str):
    profile = _load_profile_data()

    if asset_kind == "photo":
        photo_path = profile.get("photo_path")
        if not photo_path or not Path(photo_path).exists():
            raise HTTPException(status_code=404, detail="Profile photo not found.")
        return FileResponse(Path(photo_path))

    if asset_kind == "heygen-avatar":
        candidates = _image_candidates()
        if not candidates:
          raise HTTPException(status_code=404, detail="HeyGen avatar image not found.")
        return FileResponse(candidates[0])

    raise HTTPException(status_code=404, detail="Asset not found.")


@router.get("/heygen-avatar-preview")
def get_heygen_avatar_preview():
    data = _load_profile_data()
    avatar_id = data.get("heygen_avatar_id")
    if not avatar_id:
        raise HTTPException(status_code=404, detail="HeyGen avatar ID not found.")

    ensure_hermes_import_path(HERMES_ROOT)

    try:
        from skills.twin.heygen_cli import HeyGenCLIClient
        client = HeyGenCLIClient(_load_heygen_settings())
        look = client.get_avatar_look(str(avatar_id))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    preview_image_url = look.get("preview_image_url")
    if not preview_image_url:
        raise HTTPException(status_code=404, detail="HeyGen preview image not ready.")
    return {
        "avatar_id": avatar_id,
        "preview_image_url": preview_image_url,
        "status": look.get("status"),
    }


@router.post("/assets/photo")
def upload_profile_photo(file: UploadFile = File(...)):
    data = _load_profile_data()
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided.")
    suffix = Path(file.filename).suffix.lower()
    if suffix not in {".png", ".jpg", ".jpeg", ".webp"}:
        raise HTTPException(status_code=400, detail="Unsupported image type.")

    target = _profile_assets_dir() / f"identity-avatar{suffix}"
    with target.open("wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    _profile_service().update_photo_path(target)
    return {"ok": True, "photo_path": str(target)}


@router.post("/assets/heygen-avatar")
def refresh_heygen_avatar():
    data = _load_profile_data()
    photo_path = Path(data.get("photo_path", ""))
    if not photo_path.exists():
        raise HTTPException(status_code=404, detail="Profile photo not found.")

    ensure_hermes_import_path(HERMES_ROOT)

    try:
        from skills.twin.heygen_cli import HeyGenCLIClient
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not load HeyGen helpers: {exc}")

    try:
        client = HeyGenCLIClient(_load_heygen_settings())
        group_id, avatar_id = client.create_photo_avatar(
            name=f'{data.get("name", "Twin")} Identity Avatar',
            image_path=photo_path,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    _profile_service().update_profile(
        {
            "avatar_provider": "heygen",
            "heygen_avatar_group_id": group_id,
            "heygen_avatar_id": avatar_id,
        },
    )
    return {
        "ok": True,
        "avatar_provider": "heygen",
        "heygen_avatar_group_id": group_id,
        "heygen_avatar_id": avatar_id,
    }


@router.patch("")
def update_profile(body: ProfileUpdate):
    updates = body.model_dump(exclude_none=True)
    updated = _profile_service().update_profile(updates)
    return updated.to_dict()
