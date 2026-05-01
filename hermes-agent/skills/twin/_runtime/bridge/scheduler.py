from __future__ import annotations

import threading
from pathlib import Path
from typing import Callable


def write_python_script(*, target: Path, content: str) -> Path:
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")
    return target


def schedule_script_job(
    *,
    cron_jobs_module,
    hermes_home: Path,
    name: str,
    prompt: str,
    schedule: str,
    script_path: Path,
) -> dict:
    job = cron_jobs_module.create_job(
        name=name,
        prompt=prompt,
        schedule=schedule,
        repeat=1,
        deliver="local",
        script=str(script_path.relative_to(hermes_home / "scripts")),
    )
    return {
        "job_id": job["id"],
        "next_run_at": job.get("next_run_at"),
        "script_path": str(script_path),
    }


def remove_script_job(*, cron_jobs_module, job_id: str | None, script_path: str | None) -> None:
    if job_id:
        try:
            cron_jobs_module.remove_job(str(job_id))
        except Exception:
            pass
    if script_path:
        try:
            Path(str(script_path)).unlink(missing_ok=True)
        except Exception:
            pass


class CronTicker:
    def __init__(self, *, interval_seconds: int, tick: Callable[[], None]) -> None:
        self.interval_seconds = interval_seconds
        self.tick = tick
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()

        def _loop() -> None:
            while not self._stop.is_set():
                try:
                    self.tick()
                except Exception:
                    pass
                self._stop.wait(self.interval_seconds)

        self._thread = threading.Thread(target=_loop, name="twin-cron-ticker", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
