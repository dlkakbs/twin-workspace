from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace
from typing import Any

from skills.twin._runtime.bridge.call_logging import (
    wait_for_call_connection_and_mark_safe,
    wait_for_conversation_and_log_safe,
)
from skills.twin._runtime.bridge.processes import (
    run_json_command,
    run_plain_command,
    spawn_detached_process,
)
from skills.twin._runtime.bridge.scheduler import (
    CronTicker,
    remove_script_job,
    schedule_script_job,
    write_python_script,
)
from skills.twin._runtime.bridge.workers import run_scheduled_call_logger
from skills.twin._runtime.telephony.providers import (
    fetch_conversation,
    fetch_twilio_call,
    fetch_twilio_call_events,
    send_twilio_sms,
)
from skills.twin._runtime.bridge.workflows import execute_scheduled_delegation

from .workspace_contract import TwinWorkspaceContract
from .workspace_api import TwinWorkspaceAPI
from .video_call_workflow import execute_video_call_delegation


def _default_project_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _default_output_root(project_root: Path) -> Path:
    return TwinWorkspaceContract.from_values(project_root=project_root).output_root


def _default_env_path() -> Path:
    return TwinWorkspaceContract.from_values(project_root=_default_project_root()).env_path


def _hermes_python(project_root: Path) -> str:
    configured = os.environ.get("HERMES_PYTHON", "").strip()
    if configured:
        candidate = Path(configured).expanduser()
        if candidate.exists():
            return str(candidate)
    for relative in ("bin/python", "bin/python3"):
        candidate = project_root / ".venv" / relative
        if candidate.exists():
            return str(candidate)
    return sys.executable


def build_runtime_env(*, env_path: Path) -> dict[str, str]:
    env = os.environ.copy()
    for key, value in _read_env_file(env_path).items():
        env.setdefault(key, value)
    return env


def _api_from_args(args: argparse.Namespace) -> TwinWorkspaceAPI:
    return _contract_from_args(args).make_workspace_api()


def _contract_from_args(args: argparse.Namespace) -> TwinWorkspaceContract:
    return TwinWorkspaceContract.from_values(
        project_root=Path(args.project_root).expanduser().resolve(),
        output_root=Path(args.output_root).expanduser().resolve(),
        env_path=Path(args.env_path).expanduser().resolve(),
        profile_slug=args.profile_slug,
    )


def _read_env_file(path: Path) -> dict[str, str]:
    if not path.exists():
        return {}
    result: dict[str, str] = {}
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        result[key.strip()] = value.strip()
    return result


def runtime_env_loader_for_contract(contract: TwinWorkspaceContract):
    env_path = Path(contract.env_path).expanduser().resolve()

    def _runtime_env_loader() -> dict[str, str]:
        return build_runtime_env(env_path=env_path)

    return _runtime_env_loader


def humanize_provider_error(error: str) -> str:
    raw = str(error or "").strip()
    lower = raw.lower()

    if "failed to resolve" in lower or "nodename nor servname" in lower or "name resolutionerror" in lower:
        if "api.elevenlabs.io" in lower:
            return "Twin couldn't reach ElevenLabs right now. Please try again in a moment."
        if "api.heygen.com" in lower or "heygen" in lower:
            return "Twin couldn't reach HeyGen right now. Please try again in a moment."
        return "Twin couldn't reach the provider right now. Please try again in a moment."

    if "no module named 'fire'" in lower or "module named fire" in lower:
        return "Twin couldn't start the Hermes runtime. Please restart the gateway and try again."

    if "movio_payment_insufficient_credit" in lower or "requires 'api' credits" in lower or "insufficient credit" in lower and "heygen" in lower:
        return "HeyGen API credits are insufficient. Add API credits in HeyGen, then retry the video."

    if "elevenlabs" in lower and ("quota" in lower or "credit" in lower or "balance" in lower or "402" in lower):
        return "ElevenLabs credits or quota are insufficient. Add balance or increase quota in ElevenLabs, then try again."

    if "twilio" in lower and ("insufficient" in lower or "balance" in lower or "billing" in lower or "fund" in lower or "credit" in lower):
        return "Twilio balance or billing is insufficient for outbound calling. Add funds in Twilio, then retry the call."

    if "permission to send an sms has not been enabled for the region" in lower:
        return "Twilio is not allowed to send SMS messages to this country. Enable the Twilio messaging geographic permissions and try again."

    if "video meeting details because this contact has no phone number" in lower:
        return "This contact is missing a phone number. Add one to send video meeting messages."

    if "couldn't prepare the video meeting" in lower:
        return "The video meeting could not be prepared. Please try again in a few minutes."

    if "couldn't get a join link for the video meeting" in lower:
        return "The video meeting link could not be created. Please try again."

    if "elevenlabs/twilio request failed for outbound call" in lower and ("402" in lower or "credit" in lower or "balance" in lower or "billing" in lower):
        return "Twilio or ElevenLabs call billing is insufficient for this outbound call. Check both balances, then retry."

    if "elevenlabs request failed for text to speech" in lower and ("402" in lower or "quota" in lower or "credit" in lower or "balance" in lower):
        return "ElevenLabs credits or quota are insufficient for text-to-speech. Add balance or increase quota, then retry."

    return raw


def extract_timeout_video_id(error: str) -> str | None:
    match = re.search(r"HeyGen video ([a-f0-9]{32}) did not finish in time", str(error), re.IGNORECASE)
    return match.group(1) if match else None


def _heygen_cli_path(env_path: Path) -> str:
    env = build_runtime_env(env_path=env_path)
    return env.get("HEYGEN_CLI_PATH", str(Path.home() / ".local" / "bin" / "heygen"))


def run_heygen_json_for_contract(contract: TwinWorkspaceContract, *args: str) -> dict[str, Any]:
    try:
        return run_json_command(
            _heygen_cli_path(contract.env_path),
            *args,
            cwd=str(contract.project_root),
            env=build_runtime_env(env_path=contract.env_path),
            timeout=60,
        )
    except RuntimeError as exc:
        raise RuntimeError(f"HeyGen CLI failed for {' '.join(args)}: {exc}")


def run_heygen_plain_for_contract(contract: TwinWorkspaceContract, *args: str) -> None:
    try:
        run_plain_command(
            _heygen_cli_path(contract.env_path),
            *args,
            cwd=str(contract.project_root),
            env=build_runtime_env(env_path=contract.env_path),
            timeout=120,
        )
    except RuntimeError as exc:
        raise RuntimeError(f"HeyGen CLI failed for {' '.join(args)}: {exc}")


def _realtime_api_from_args(args: argparse.Namespace):
    contract = _contract_from_args(args)

    storage_reader_stub = SimpleNamespace(
        list_all_calls=lambda: [],
        list_delegations=lambda: [],
    )
    return contract.make_realtime_workspace_api(
        runtime_env_loader=runtime_env_loader_for_contract(contract),
        storage_reader_module=storage_reader_stub,
    )


def _common_parser_defaults(parser: argparse.ArgumentParser) -> None:
    project_root = _default_project_root()
    parser.add_argument("--project-root", default=str(project_root))
    parser.add_argument("--output-root", default=str(_default_output_root(project_root)))
    parser.add_argument("--env-path", default=str(_default_env_path()))
    parser.add_argument("--profile-slug", default=os.environ.get("TWIN_PROFILE_SLUG", "dilek"))


def schedule_delegation_cron_job(
    *,
    contract: TwinWorkspaceContract,
    delegation_path: str,
    scheduled_for: str,
    title: str,
    channel: str,
) -> dict[str, Any]:
    try:
        import cron.jobs as cron_jobs
    except Exception as exc:
        raise RuntimeError(f"Could not import Hermes cron jobs: {exc}")

    hermes_home = Path(contract.env_path).expanduser().resolve().parent
    scripts_dir = hermes_home / "scripts" / "twin-workspace"
    scripts_dir.mkdir(parents=True, exist_ok=True)

    delegation_id = Path(delegation_path).resolve().parent.name
    script_path = scripts_dir / f"{delegation_id}.py"
    hermes_python = _hermes_python(contract.project_root)
    command_args = ",\n    ".join(repr(part) for part in contract.workspace_command_args())
    content = f"""from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

HERMES_PYTHON = Path({hermes_python!r})

if HERMES_PYTHON.exists() and Path(sys.executable).resolve() != HERMES_PYTHON.resolve():
    os.execv(str(HERMES_PYTHON), [str(HERMES_PYTHON), __file__])

PYTHON = str(HERMES_PYTHON if HERMES_PYTHON.exists() else Path(sys.executable).resolve())

cmd = [
    PYTHON,
    "-m",
    "skills.twin.workspace_commands",
    "scheduled-delegation",
    {command_args},
    "--delegation-path", {str(Path(delegation_path).resolve())!r},
    "--source", "cron",
]
raise SystemExit(subprocess.call(cmd, cwd={str(contract.project_root)!r}))
"""
    written_script = write_python_script(target=script_path, content=content)
    return schedule_script_job(
        cron_jobs_module=cron_jobs,
        hermes_home=hermes_home,
        name=f"Twin {channel}: {title[:40]}",
        prompt="If the pre-run script failed, summarize the error briefly. Otherwise respond with [SILENT].",
        schedule=scheduled_for,
        script_path=written_script,
    )


def remove_delegation_cron_job(*, task: dict[str, Any]) -> None:
    metadata = task.get("metadata") or {}
    job_id = metadata.get("scheduled_job_id")
    script_path = metadata.get("scheduled_job_script")
    try:
        import cron.jobs as cron_jobs
    except Exception:
        cron_jobs = None

    remove_script_job(
        cron_jobs_module=cron_jobs,
        job_id=str(job_id) if job_id else None,
        script_path=str(script_path) if script_path else None,
    )


def run_video_call_for_contract(
    *,
    contract: TwinWorkspaceContract,
    delegation_path: str,
    source: str,
    storage_reader_module: Any | None = None,
) -> dict[str, Any]:
    realtime_api = contract.make_realtime_workspace_api(
        runtime_env_loader=runtime_env_loader_for_contract(contract),
        storage_reader_module=storage_reader_module
        or SimpleNamespace(list_all_calls=lambda: [], list_delegations=lambda: []),
    )
    path = Path(delegation_path).expanduser().resolve()
    task = json.loads(path.read_text(encoding="utf-8"))
    env_path = Path(contract.env_path).expanduser().resolve()
    return execute_video_call_delegation(
        delegation_path=path,
        task=task,
        source=source,
        persist_task=_persist_task,
        create_video_session=lambda **kwargs: realtime_api.create_session(**kwargs),
        start_video_session=lambda **kwargs: realtime_api.start_session(kwargs["video_session_id"]),
        send_invite_sms=lambda **kwargs: send_twilio_sms(env_path=env_path, **kwargs),
        now_iso=realtime_api.utc_now_iso,
    )


def spawn_scheduled_call_logger_process(
    *,
    contract: TwinWorkspaceContract,
    delegation_path: str,
    call_run_path: str,
    conversation_id: str,
    call_sid: str | None = None,
    summary_language: str = "en",
) -> None:
    cmd = [
        _hermes_python(contract.project_root),
        "-m",
        "skills.twin.workspace_commands",
        "scheduled-call-logger",
        *contract.workspace_command_args(),
        "--delegation-path", delegation_path,
        "--call-run-path", call_run_path,
        "--conversation-id", conversation_id,
        "--summary-language", summary_language.strip().lower() or "en",
    ]
    if call_sid:
        cmd += ["--call-sid", call_sid]
    spawn_detached_process(
        cmd=cmd,
        cwd=str(contract.project_root),
        env=build_runtime_env(env_path=contract.env_path),
        stdout_path=None,
    )


def spawn_content_run_process(
    *,
    contract: TwinWorkspaceContract,
    delegation_path: str,
    source: str,
) -> int:
    delegation = Path(delegation_path).expanduser().resolve()
    logs_dir = delegation.parent / "logs"
    logs_dir.mkdir(parents=True, exist_ok=True)
    log_path = logs_dir / "content-run.log"
    _ = source
    return spawn_detached_process(
        cmd=[
            _hermes_python(contract.project_root),
            "-m",
            "skills.twin.workspace_commands",
            "content-run",
            *contract.workspace_command_args(),
            "--delegation-path", str(delegation),
        ],
        cwd=str(contract.project_root),
        env=build_runtime_env(env_path=contract.env_path),
        stdout_path=str(log_path),
    )


def run_workspace_maintenance_tick(
    *,
    contract: TwinWorkspaceContract,
    storage_reader_module: Any,
    execute_delegation: Any,
    tick_cron_scheduler: Any,
) -> None:
    api = contract.make_workspace_api()
    api.run_workspace_maintenance_tick(
        tasks=storage_reader_module.list_delegations(),
        execute_delegation=execute_delegation,
        storage_reader_module=storage_reader_module,
        runs_dir=storage_reader_module.RUNS_DIR,
        run_heygen_json=lambda *args: run_heygen_json_for_contract(contract, *args),
        run_heygen_plain=lambda *args: run_heygen_plain_for_contract(contract, *args),
        extract_timeout_video_id=extract_timeout_video_id,
        humanize_provider_error=humanize_provider_error,
        persist_task=_persist_task,
        tick_cron_scheduler=tick_cron_scheduler,
    )


def create_workspace_maintenance_ticker(
    *,
    contract: TwinWorkspaceContract,
    storage_reader_module: Any,
    execute_delegation: Any,
    tick_cron_scheduler: Any,
    interval_seconds: int = 30,
) -> CronTicker:
    def _tick() -> None:
        run_workspace_maintenance_tick(
            contract=contract,
            storage_reader_module=storage_reader_module,
            execute_delegation=execute_delegation,
            tick_cron_scheduler=tick_cron_scheduler,
        )

    return CronTicker(interval_seconds=interval_seconds, tick=_tick)


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Hermes workspace-facing Twin command surface.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    content_run = subparsers.add_parser("content-run", help="Run Twin content generation for a delegation.")
    _common_parser_defaults(content_run)
    content_run.add_argument("--delegation-path", required=True)

    call_logger = subparsers.add_parser("scheduled-call-logger", help="Watch a call and auto-log its outcome.")
    _common_parser_defaults(call_logger)
    call_logger.add_argument("--delegation-path", required=True)
    call_logger.add_argument("--call-run-path", required=True)
    call_logger.add_argument("--conversation-id", required=True)
    call_logger.add_argument("--call-sid")
    call_logger.add_argument("--summary-language", default=os.environ.get("TWIN_SUMMARY_LANGUAGE", "en").strip().lower())

    scheduled = subparsers.add_parser("scheduled-delegation", help="Execute a scheduled Twin delegation from Hermes cron.")
    _common_parser_defaults(scheduled)
    scheduled.add_argument("--delegation-path", required=True)
    scheduled.add_argument("--source", default="cron")

    return parser


def _cmd_content_run(args: argparse.Namespace) -> int:
    api = _api_from_args(args)
    result = api.content_run_for_delegation(Path(args.delegation_path).expanduser().resolve())
    print(json.dumps({"ok": True, "result": result}, ensure_ascii=False))
    return 0


def run_content_worker_entrypoint(
    *,
    contract: TwinWorkspaceContract,
    delegation_path: str,
    source: str = "content-worker",
) -> dict[str, Any]:
    _ = source
    return contract.make_workspace_api().content_run_for_delegation(
        Path(delegation_path).expanduser().resolve()
    )


def _cmd_scheduled_call_logger(args: argparse.Namespace) -> int:
    return run_scheduled_call_logger_entrypoint(
        contract=_contract_from_args(args),
        delegation_path=args.delegation_path,
        call_run_path=args.call_run_path,
        conversation_id=args.conversation_id,
        call_sid=args.call_sid,
        summary_language=args.summary_language,
    )


def run_scheduled_call_logger_entrypoint(
    *,
    contract: TwinWorkspaceContract,
    delegation_path: str,
    call_run_path: str,
    conversation_id: str,
    call_sid: str | None = None,
    summary_language: str = "en",
) -> int:
    api = contract.make_workspace_api()

    def _log_call(**kwargs):
        return api.log_call(**kwargs)

    def _wait_for_call_connection_and_mark_safe(**kwargs):
        return wait_for_call_connection_and_mark_safe(
            **kwargs,
            fetch_twilio_call=lambda sid: fetch_twilio_call(env_path=Path(contract.env_path), call_sid=sid),
            fetch_twilio_call_events=lambda sid: fetch_twilio_call_events(env_path=Path(contract.env_path), call_sid=sid),
        )

    def _wait_for_conversation_and_log_safe(**kwargs):
        return wait_for_conversation_and_log_safe(
            **kwargs,
            fetch_conversation=lambda target_conversation_id: fetch_conversation(
                env_path=Path(contract.env_path),
                conversation_id=target_conversation_id,
            ),
            log_call=_log_call,
            summary_language=summary_language,
        )

    return run_scheduled_call_logger(
        delegation_path=delegation_path,
        call_run_path=call_run_path,
        conversation_id=conversation_id,
        call_sid=call_sid,
        wait_for_call_connection_and_mark_safe=_wait_for_call_connection_and_mark_safe,
        wait_for_conversation_and_log_safe=_wait_for_conversation_and_log_safe,
    )


def wait_for_call_connection_for_contract(
    *,
    contract: TwinWorkspaceContract,
    call_run_path: str,
    call_sid: str,
    timeout_seconds: int = 35,
    poll_interval_seconds: int = 5,
) -> None:
    wait_for_call_connection_and_mark_safe(
        call_run_path=call_run_path,
        call_sid=call_sid,
        timeout_seconds=timeout_seconds,
        poll_interval_seconds=poll_interval_seconds,
        fetch_twilio_call=lambda sid: fetch_twilio_call(env_path=Path(contract.env_path), call_sid=sid),
        fetch_twilio_call_events=lambda sid: fetch_twilio_call_events(env_path=Path(contract.env_path), call_sid=sid),
    )


def wait_for_conversation_and_log_for_contract(
    *,
    contract: TwinWorkspaceContract,
    delegation_path: str,
    call_run_path: str,
    conversation_id: str,
    timeout_seconds: int = 900,
    poll_interval_seconds: int = 10,
    summary_language: str = "en",
) -> None:
    api = contract.make_workspace_api()
    wait_for_conversation_and_log_safe(
        delegation_path=delegation_path,
        call_run_path=call_run_path,
        conversation_id=conversation_id,
        timeout_seconds=timeout_seconds,
        poll_interval_seconds=poll_interval_seconds,
        fetch_conversation=lambda target_conversation_id: fetch_conversation(
            env_path=Path(contract.env_path),
            conversation_id=target_conversation_id,
        ),
        log_call=lambda **kwargs: api.log_call(**kwargs),
        summary_language=summary_language,
    )


def _persist_task(path: str | Path, task: dict) -> None:
    Path(path).write_text(json.dumps(task, indent=2, ensure_ascii=False), encoding="utf-8")


def _record_delegation_failure(*, delegation_path: str | Path, task: dict, error: str, source: str) -> None:
    metadata = dict(task.get("metadata") or {})
    metadata["last_error"] = error
    metadata["last_error_raw"] = error
    metadata["last_error_source"] = source
    task["metadata"] = metadata
    task["status"] = "failed"
    _persist_task(delegation_path, task)


def _spawn_scheduled_call_logger(args: argparse.Namespace, *, delegation_path: str, call_run_path: str, conversation_id: str, call_sid: str | None = None) -> None:
    spawn_scheduled_call_logger_process(
        contract=_contract_from_args(args),
        delegation_path=delegation_path,
        call_run_path=call_run_path,
        conversation_id=conversation_id,
        call_sid=call_sid,
        summary_language=os.environ.get("TWIN_SUMMARY_LANGUAGE", "en").strip().lower(),
    )


def _spawn_content_run_process(args: argparse.Namespace, *, delegation_path: str, source: str) -> int:
    return spawn_content_run_process(
        contract=_contract_from_args(args),
        delegation_path=delegation_path,
        source=source,
    )


def _run_video_call(args: argparse.Namespace, *, delegation_path: str, source: str) -> dict[str, Any]:
    return run_video_call_for_contract(
        contract=_contract_from_args(args),
        delegation_path=delegation_path,
        source=source,
    )


def _cmd_scheduled_delegation(args: argparse.Namespace) -> int:
    api = _api_from_args(args)
    result = execute_scheduled_delegation(
        delegation_path=Path(args.delegation_path).expanduser().resolve(),
        source=args.source,
        remove_cron_job=remove_delegation_cron_job,
        persist_task=_persist_task,
        call_run=lambda **kwargs: api.call_run(**kwargs),
        run_video_call=lambda **kwargs: _run_video_call(args, **kwargs),
        spawn_content_run_process=lambda **kwargs: _spawn_content_run_process(args, **kwargs),
        spawn_call_log_process=lambda **kwargs: _spawn_scheduled_call_logger(args, **kwargs),
        record_failure=_record_delegation_failure,
    )
    print(json.dumps({"ok": True, "result": result}, ensure_ascii=False))
    print(json.dumps({"wakeAgent": False}, ensure_ascii=False))
    return 0


def main() -> int:
    parser = _build_parser()
    args = parser.parse_args()

    if args.command == "content-run":
        return _cmd_content_run(args)
    if args.command == "scheduled-call-logger":
        return _cmd_scheduled_call_logger(args)
    if args.command == "scheduled-delegation":
        return _cmd_scheduled_delegation(args)

    parser.error(f"Unknown command: {args.command}")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
