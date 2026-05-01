from __future__ import annotations

import argparse
import json
import sys
import traceback

from config import HERMES_ROOT
from env_utils import twin_workspace_contract
from hermes_imports import ensure_hermes_import_path

ensure_hermes_import_path(HERMES_ROOT)

from skills.twin.workspace_commands import run_content_worker_entrypoint


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Compatibility shim that forwards detached Twin content work to Hermes."
    )
    parser.add_argument("--delegation-path", required=True)
    parser.add_argument("--source", default="content-worker")
    args = parser.parse_args()

    try:
        result = run_content_worker_entrypoint(
            contract=twin_workspace_contract(),
            delegation_path=args.delegation_path,
            source=args.source,
        )
        print(json.dumps({"ok": True, "result": result}, ensure_ascii=False))
        return 0
    except Exception as exc:
        print(f"Detached content worker failed: {exc}", file=sys.stderr)
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
