import os

from workspace_paths import (
    DELEGATIONS_DIR,
    HERMES_OUTPUTS,
    HERMES_ROOT,
    PROFILE_JSON,
    RUNS_DIR,
    TWIN_PROFILE_SLUG,
    VIDEO_SESSIONS_DIR,
)

HERMES_API_SERVER_URL = os.environ.get("HERMES_API_SERVER_URL", "http://localhost:8642")
TWIN_SUMMARY_LANGUAGE = os.environ.get("TWIN_SUMMARY_LANGUAGE", "en").strip().lower()
