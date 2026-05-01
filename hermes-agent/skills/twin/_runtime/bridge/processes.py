from __future__ import annotations

import json
import os
import signal
import subprocess
from pathlib import Path
from typing import Any


def run_json_command(*cmd: str, cwd: str, env: dict[str, str], timeout: int = 60) -> dict[str, Any]:
    result = subprocess.run(
        list(cmd),
        capture_output=True,
        text=True,
        cwd=cwd,
        env=env,
        timeout=timeout,
    )
    if result.returncode != 0:
        detail = result.stderr.strip() or result.stdout.strip() or f"exit={result.returncode}"
        raise RuntimeError(detail)
    return json.loads(result.stdout.strip())


def run_plain_command(*cmd: str, cwd: str, env: dict[str, str], timeout: int = 120) -> None:
    result = subprocess.run(
        list(cmd),
        capture_output=True,
        text=True,
        cwd=cwd,
        env=env,
        timeout=timeout,
    )
    if result.returncode != 0:
        detail = result.stderr.strip() or result.stdout.strip() or f"exit={result.returncode}"
        raise RuntimeError(detail)


def spawn_detached_process(
    *,
    cmd: list[str],
    cwd: str,
    env: dict[str, str],
    stdout_path: str | None = None,
    stderr_to_stdout: bool = True,
) -> int:
    stdout_handle = None
    try:
        if stdout_path:
            path = Path(stdout_path)
            path.parent.mkdir(parents=True, exist_ok=True)
            stdout_handle = path.open("a", encoding="utf-8")
            stderr = stdout_handle if stderr_to_stdout else subprocess.DEVNULL
            stdout = stdout_handle
        else:
            stdout = subprocess.DEVNULL
            stderr = subprocess.DEVNULL if stderr_to_stdout else subprocess.DEVNULL
        process = subprocess.Popen(
            cmd,
            cwd=cwd,
            env=env,
            stdout=stdout,
            stderr=stderr,
            start_new_session=True,
        )
        return process.pid
    finally:
        if stdout_handle:
            stdout_handle.close()


def terminate_process_group(pid: int | None) -> bool:
    if not pid:
        return False
    try:
        os.killpg(pid, signal.SIGTERM)
        return True
    except Exception:
        return False

