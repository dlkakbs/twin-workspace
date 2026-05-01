from __future__ import annotations

from config import HERMES_ROOT
from hermes_imports import ensure_hermes_import_path

ensure_hermes_import_path(HERMES_ROOT)

from skills.twin._runtime.realtime.liveavatar import LiveAvatarClient
