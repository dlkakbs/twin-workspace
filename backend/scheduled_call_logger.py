from __future__ import annotations

import argparse

from config import HERMES_ROOT
from env_utils import twin_workspace_contract
from hermes_imports import ensure_hermes_import_path

ensure_hermes_import_path(HERMES_ROOT)

from skills.twin.workspace_commands import run_scheduled_call_logger_entrypoint


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Compatibility shim that forwards scheduled call logging to Hermes."
    )
    parser.add_argument("--delegation-path", required=True)
    parser.add_argument("--call-run-path", required=True)
    parser.add_argument("--conversation-id", required=True)
    parser.add_argument("--call-sid")
    args = parser.parse_args()

    return run_scheduled_call_logger_entrypoint(
        contract=twin_workspace_contract(),
        delegation_path=args.delegation_path,
        call_run_path=args.call_run_path,
        conversation_id=args.conversation_id,
        call_sid=args.call_sid,
    )


if __name__ == "__main__":
    raise SystemExit(main())
