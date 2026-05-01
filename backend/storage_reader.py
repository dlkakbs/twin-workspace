"""
Read-only views over the Hermes/Twin file-based storage.
All data lives under the shared Twin workspace contract paths.
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from workspace_paths import DELEGATIONS_DIR, PROFILE_JSON, RUNS_DIR


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def hydrate_call_record(data: dict[str, Any]) -> dict[str, Any]:
    transcript_path = data.get("transcript_path")
    if transcript_path:
        try:
            data["transcript"] = Path(transcript_path).read_text(encoding="utf-8")
        except Exception:
            data["transcript"] = None
    else:
        data["transcript"] = None
    return data


def _latest_call_run_manifest(delegation_path: Path) -> dict[str, Any] | None:
    calls_dir = delegation_path.parent / "calls"
    if not calls_dir.exists():
        return None
    candidates = sorted(calls_dir.glob("*_call_run.json"), reverse=True)
    for path in candidates:
        try:
            payload = read_json(path)
        except Exception:
            continue
        payload["_path"] = str(path)
        return payload
    return None


def _voice_call_delivery_failure(data: dict[str, Any], latest_call_run: dict[str, Any] | None) -> tuple[str, dict[str, Any]] | None:
    if data.get("channel") != "voice_call" or not latest_call_run:
        return None

    connection_status = str(latest_call_run.get("call_connection_status") or "").strip().lower()
    if connection_status not in {"failed", "busy", "canceled", "no-answer", "no_answer"}:
        return None

    sip_code = str(latest_call_run.get("sip_response_code") or "").strip()
    label = {
        "failed": "Outbound call could not be delivered",
        "busy": "The destination line was busy",
        "canceled": "The outbound call was canceled",
        "no-answer": "The call rang but was not answered",
        "no_answer": "The call rang but was not answered",
    }.get(connection_status, "The call could not be completed")
    if sip_code:
        label = f"{label} (SIP {sip_code})"

    metadata = dict(data.get("metadata") or {})
    metadata["last_error"] = label + "."
    metadata["last_error_source"] = "voice_delivery"
    if sip_code:
        metadata["last_error_raw"] = f"twilio_status={connection_status}; sip_response_code={sip_code}"
    else:
        metadata["last_error_raw"] = f"twilio_status={connection_status}"
    return "failed", metadata


def _latest_partial_content_run(data: dict[str, Any], delegation_path: Path) -> dict[str, Any] | None:
    if data.get("channel") != "content_creation":
        return None
    existing_run = data.get("latest_content_run")
    if existing_run:
        run_id = existing_run.get("run_id")
        if run_id:
            run_dir = RUNS_DIR / str(run_id)
            if run_dir.exists():
                script_path = run_dir / "script.txt"
                video_path = run_dir / "avatar.mp4"
                manifest_path = run_dir / "manifest.json"
                audio_candidates = sorted(run_dir.glob("narration.*"))
                audio_path = audio_candidates[0] if audio_candidates else None
                enriched_run = dict(existing_run)
                enriched_run["manifest_path"] = str(manifest_path) if manifest_path.exists() else existing_run.get("manifest_path")
                enriched_run["script_path"] = str(script_path) if script_path.exists() else existing_run.get("script_path")
                enriched_run["audio_path"] = str(audio_path) if audio_path and audio_path.exists() else existing_run.get("audio_path")
                enriched_run["video_path"] = str(video_path) if video_path.exists() else existing_run.get("video_path")
                return enriched_run
        return existing_run

    if not RUNS_DIR.exists():
        return None

    metadata = data.get("metadata") or {}
    relaxed_match = bool(metadata.get("heygen_video_id")) or str(data.get("status") or "").strip().lower() == "running"
    source_script_text = None
    source_script_path = metadata.get("source_script_path")
    if source_script_path:
        try:
            source_script_text = Path(str(source_script_path)).read_text(encoding="utf-8").strip()
        except OSError:
            source_script_text = None
    try:
        delegation_mtime = delegation_path.stat().st_mtime
    except OSError:
        delegation_mtime = 0

    candidates: list[tuple[float, Path, Path | None]] = []
    exact_script_matches: list[tuple[float, Path, Path | None]] = []
    for run_dir in RUNS_DIR.iterdir():
        if not run_dir.is_dir():
            continue
        script_path = run_dir / "script.txt"
        video_path = run_dir / "avatar.mp4"
        manifest_path = run_dir / "manifest.json"
        audio_candidates = sorted(run_dir.glob("narration.*"))
        audio_path = audio_candidates[0] if audio_candidates else None
        existing_paths = [path for path in (script_path, audio_path, video_path, manifest_path) if path and path.exists()]
        if not existing_paths:
            continue
        try:
            mtime = max(path.stat().st_mtime for path in existing_paths)
        except ValueError:
            continue
        candidates.append((mtime, run_dir, audio_path))
        if source_script_text and script_path.exists():
            try:
                if script_path.read_text(encoding="utf-8").strip() == source_script_text:
                    exact_script_matches.append((mtime, run_dir, audio_path))
            except OSError:
                pass

    if not candidates:
        return None

    if exact_script_matches:
        _, run_dir, detected_audio_path = max(exact_script_matches, key=lambda item: item[0])
    elif relaxed_match:
        _, run_dir, detected_audio_path = max(candidates, key=lambda item: item[0])
    else:
        time_window_seconds = 60 * 60
        windowed_candidates = [
            item for item in candidates
            if abs(item[0] - delegation_mtime) <= time_window_seconds
        ]
        if not windowed_candidates:
            return None
        _, run_dir, detected_audio_path = min(
            windowed_candidates,
            key=lambda item: (abs(item[0] - delegation_mtime), -item[0]),
        )

    script_path = run_dir / "script.txt"
    video_path = run_dir / "avatar.mp4"
    manifest_path = run_dir / "manifest.json"
    return {
        "run_id": run_dir.name,
        "format": (data.get("metadata") or {}).get("content_subtype", "video"),
        "manifest_path": str(manifest_path) if manifest_path.exists() else None,
        "script_path": str(script_path) if script_path.exists() else None,
        "audio_path": str(detected_audio_path) if detected_audio_path and detected_audio_path.exists() else None,
        "video_path": str(video_path) if video_path.exists() else None,
    }


def _content_run_presence(
    partial_run: dict[str, Any] | None,
    content_subtype: str,
) -> tuple[bool, bool]:
    if not partial_run:
        return False, False

    has_script = bool(partial_run.get("script_path"))
    has_audio = bool(partial_run.get("audio_path"))
    has_video = bool(partial_run.get("video_path"))
    has_any_output = has_video or has_audio or has_script
    has_final_output = (
        has_video if content_subtype == "video"
        else has_audio if content_subtype == "audio"
        else has_script if content_subtype == "script"
        else has_any_output
    )
    return has_any_output, has_final_output


def _path_mtime(path_value: str | None) -> float | None:
    if not path_value:
        return None
    try:
        return Path(path_value).expanduser().resolve().stat().st_mtime
    except OSError:
        return None


def _path_created_time(path: Path) -> float:
    stats = path.stat()
    return float(getattr(stats, "st_birthtime", stats.st_ctime))


def _delegation_timestamps(
    delegation_path: Path,
    *,
    latest_call_run: dict[str, Any] | None,
    partial_run: dict[str, Any] | None,
) -> tuple[str, str]:
    created_ts = _path_created_time(delegation_path)
    updated_candidates = [delegation_path.stat().st_mtime]

    if latest_call_run:
        latest_call_mtime = _path_mtime(latest_call_run.get("_path"))
        if latest_call_mtime is not None:
            updated_candidates.append(latest_call_mtime)

    if partial_run:
        for key in ("manifest_path", "script_path", "audio_path", "video_path"):
            artifact_mtime = _path_mtime(partial_run.get(key))
            if artifact_mtime is not None:
                updated_candidates.append(artifact_mtime)

    created_at = datetime.fromtimestamp(created_ts).astimezone().isoformat()
    updated_at = datetime.fromtimestamp(max(updated_candidates)).astimezone().isoformat()
    return created_at, updated_at


def _hydrate_delegation(data: dict[str, Any], delegation_path: Path) -> dict[str, Any]:
    latest_call_run = _latest_call_run_manifest(delegation_path)
    if latest_call_run and data.get("channel") == "voice_call":
        if not data.get("latest_call_path"):
            data["latest_call_path"] = str(latest_call_run["_path"])
        status = str(data.get("status") or "").strip().lower()
        if status == "planned":
            data["status"] = "running"
        delivery_failure = _voice_call_delivery_failure(data, latest_call_run)
        if delivery_failure:
            failed_status, failed_metadata = delivery_failure
            data["status"] = failed_status
            data["metadata"] = failed_metadata

    partial_run = _latest_partial_content_run(data, delegation_path)
    if partial_run:
        data["latest_content_run"] = partial_run
        metadata = data.get("metadata") or {}
        status = str(data.get("status") or "").strip().lower()
        if status == "planned" and not metadata.get("scheduled_job_id"):
            data["status"] = "running"

        content_subtype = str((metadata.get("content_subtype") or "video")).strip().lower()
        has_any_output, has_final_output = _content_run_presence(partial_run, content_subtype)
        if has_final_output:
            data["status"] = "completed"
            clean_metadata = dict(metadata)
            clean_metadata.pop("heygen_video_id", None)
            clean_metadata.pop("heygen_video_status", None)
            clean_metadata.pop("last_error", None)
            clean_metadata.pop("last_error_raw", None)
            clean_metadata.pop("last_error_source", None)
            data["metadata"] = clean_metadata
        elif has_any_output and status == "failed":
            data["status"] = "partial"

    metadata = dict(data.get("metadata") or {})
    status = str(data.get("status") or "").strip().lower()
    scheduled_for = data.get("scheduled_for")
    has_schedule_handle = bool(metadata.get("scheduled_job_id") or metadata.get("scheduled_job_script"))
    if status == "planned" and scheduled_for and not has_schedule_handle:
        try:
            run_at = datetime.fromisoformat(str(scheduled_for).replace("Z", "+00:00")).astimezone()
        except ValueError:
            run_at = None
        grace_period = timedelta(minutes=2)
        if run_at and run_at + grace_period <= datetime.now().astimezone():
            metadata.setdefault(
                "last_error",
                "This scheduled run is past due and no active Hermes cron job is attached to it."
            )
            metadata.setdefault("last_error_source", "storage_reader")
            data["metadata"] = metadata
            data["status"] = "failed"

    created_at, updated_at = _delegation_timestamps(
        delegation_path,
        latest_call_run=latest_call_run,
        partial_run=partial_run,
    )
    data["created_at"] = str(data.get("created_at") or created_at)
    data["updated_at"] = str(data.get("updated_at") or updated_at)
    data["_path"] = str(delegation_path)
    return data


# ─── Profile ────────────────────────────────────────────────────────────────

def get_profile() -> dict[str, Any] | None:
    if PROFILE_JSON.exists():
        return read_json(PROFILE_JSON)
    return None


# ─── Delegations ─────────────────────────────────────────────────────────────

def list_delegations() -> list[dict[str, Any]]:
    if not DELEGATIONS_DIR.exists():
        return []
    results = []
    for slug_dir in sorted(DELEGATIONS_DIR.iterdir(), reverse=True):
        if not slug_dir.is_dir():
            continue
        d_path = slug_dir / "delegation.json"
        if d_path.exists():
            try:
                data = read_json(d_path)
                results.append(_hydrate_delegation(data, d_path))
            except Exception:
                pass
    return results


def get_delegation(delegation_id: str) -> dict[str, Any] | None:
    # Fast path: folder name matches delegation_id (Hermes native IDs)
    d_path = DELEGATIONS_DIR / delegation_id / "delegation.json"
    if d_path.exists():
        data = read_json(d_path)
        return _hydrate_delegation(data, d_path)
    # Fallback: scan all delegations and match by delegation_id field inside JSON
    if DELEGATIONS_DIR.exists():
        for slug_dir in DELEGATIONS_DIR.iterdir():
            if not slug_dir.is_dir():
                continue
            d_path = slug_dir / "delegation.json"
            if d_path.exists():
                try:
                    data = read_json(d_path)
                    if data.get("delegation_id") == delegation_id:
                        return _hydrate_delegation(data, d_path)
                except Exception:
                    pass
    return None


# ─── Call records ─────────────────────────────────────────────────────────────

def list_calls_for(delegation_id: str) -> list[dict[str, Any]]:
    calls_dir = DELEGATIONS_DIR / delegation_id / "calls"
    if not calls_dir.exists():
        return []
    records = []
    for f in sorted(calls_dir.glob("*.json"), reverse=True):
        if "call_run" in f.name:
            continue  # skip run manifests, only return call records
        try:
            data = read_json(f)
            data["_path"] = str(f)
            records.append(hydrate_call_record(data))
        except Exception:
            pass
    return records


def list_all_calls() -> list[dict[str, Any]]:
    if not DELEGATIONS_DIR.exists():
        return []
    all_calls = []
    for slug_dir in DELEGATIONS_DIR.iterdir():
        if not slug_dir.is_dir():
            continue
        all_calls.extend(list_calls_for(slug_dir.name))
    all_calls.sort(key=lambda c: c.get("call_id", ""), reverse=True)
    return all_calls


def get_call(call_id: str) -> dict[str, Any] | None:
    if not DELEGATIONS_DIR.exists():
        return None
    for slug_dir in DELEGATIONS_DIR.iterdir():
        if not slug_dir.is_dir():
            continue
        calls_dir = slug_dir / "calls"
        for f in calls_dir.glob("*.json"):
            if call_id in f.name and "call_run" not in f.name:
                return hydrate_call_record(read_json(f))
    return None
