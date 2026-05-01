from __future__ import annotations

import os
from pathlib import Path


HERMES_HOME_DIR = Path(os.environ.get("HERMES_HOME", str(Path.home() / ".hermes"))).expanduser()
HERMES_HOME_ENV = HERMES_HOME_DIR / ".env"


def read_env_file(path: Path) -> dict[str, str]:
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


def merged_runtime_env() -> dict[str, str]:
    env = os.environ.copy()
    for key, value in read_env_file(HERMES_HOME_ENV).items():
        env.setdefault(key, value)
    return env

