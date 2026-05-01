from __future__ import annotations
"""Compatibility shim for the Hermes-owned Pipecat runtime worker."""

import sys

from config import HERMES_ROOT
from hermes_imports import ensure_hermes_import_path

ensure_hermes_import_path(HERMES_ROOT)

from skills.twin._runtime.realtime.pipecat_worker import main


if __name__ == "__main__":
    sys.exit(main())
