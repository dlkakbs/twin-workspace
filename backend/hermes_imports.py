from __future__ import annotations

import sys
from pathlib import Path


def ensure_hermes_import_path(hermes_root: Path) -> Path:
    resolved = Path(hermes_root).expanduser().resolve()
    hermes_root_str = str(resolved)
    if hermes_root_str not in sys.path:
        sys.path.insert(0, hermes_root_str)
    return resolved
