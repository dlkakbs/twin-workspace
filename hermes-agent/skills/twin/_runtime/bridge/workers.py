from __future__ import annotations

from threading import Thread
from typing import Callable


def run_scheduled_call_logger(
    *,
    delegation_path: str,
    call_run_path: str,
    conversation_id: str,
    call_sid: str | None,
    wait_for_call_connection_and_mark_safe: Callable[..., None],
    wait_for_conversation_and_log_safe: Callable[..., None],
) -> int:
    watcher: Thread | None = None
    if call_sid:
        watcher = Thread(
            target=wait_for_call_connection_and_mark_safe,
            kwargs={
                "call_run_path": call_run_path,
                "call_sid": call_sid,
            },
            daemon=True,
        )
        watcher.start()

    wait_for_conversation_and_log_safe(
        delegation_path=delegation_path,
        call_run_path=call_run_path,
        conversation_id=conversation_id,
    )
    if watcher:
        watcher.join(timeout=1)
    return 0


def run_content_worker(
    *,
    delegation_path: str,
    source: str,
    content_run: Callable[..., dict],
) -> dict:
    _ = source
    return content_run(delegation_path=delegation_path)
