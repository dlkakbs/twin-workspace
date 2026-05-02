# Twin Workspace Integration Contract

This document describes how workspace or dashboard applications should
integrate with Twin from Hermes without taking ownership of Twin domain logic.

## Ownership model

The ownership split is:

- `skills.twin`:
  - profile domain
  - delegation domain
  - content generation domain
  - call logging domain
- `skills.twin._runtime.telephony`:
  - Twilio / ElevenLabs provider runtime helpers
- `skills.twin._runtime.realtime`:
  - LiveAvatar / LiveKit / Pipecat runtime helpers
- workspace app:
  - control plane
  - UI
  - operator workflows
  - asset browsing

Guiding rule:

- if a workflow mutates Twin profile, delegation, content-run, call-log, or
  realtime session state, that mutation should live on the Hermes side
- workspace code may present, trigger, or poll those workflows, but should not
  become the source of truth for them

Workspace code should not become the canonical owner of Twin profile state,
delegation state, realtime session state, or provider runtime behavior.

## Preferred integration surface

Use this Hermes-side entrypoint:

- `skills.twin.TwinWorkspaceContract`

This contract normalizes:

- `project_root`
- `output_root`
- `env_path`
- `profile_slug`

Example:

```python
from pathlib import Path

from skills.twin import TwinWorkspaceContract

contract = TwinWorkspaceContract.from_values(
    project_root=Path("/path/to/hermes-agent"),
    output_root=Path("/path/to/hermes-agent/outputs/twin"),
    env_path=Path.home() / ".hermes" / ".env",
    profile_slug="example-user",
)

workspace_api = contract.make_workspace_api()
realtime_api = contract.make_realtime_workspace_api(
    runtime_env_loader=lambda: {},
    storage_reader_module=storage_reader,
)
```

This is the preferred path for any external dashboard, control panel, or
workspace repository that wants to consume Twin from Hermes.

## Facades

### `TwinWorkspaceAPI`

Use for:

- reading/updating profile data
- reading/writing Twin settings
- creating delegations
- running calls
- logging calls
- running delegation-scoped content generation

### `TwinRealtimeWorkspaceAPI`

Use for:

- create/start/end realtime sessions
- list/get realtime sessions
- public invite lookup
- realtime debug snapshot

## Command surface

For detached or cron-safe execution, prefer:

- `python -m skills.twin.workspace_commands content-run`
- `python -m skills.twin.workspace_commands scheduled-call-logger`
- `python -m skills.twin.workspace_commands scheduled-delegation`

These commands let background workflows run without importing workspace backend
modules directly.

If a workspace needs to schedule, spawn, or recover Twin background work, it
should prefer this command surface over local backend worker modules.

## Optional runtime surfaces

Install these optional skills when you need runtime-specific helper scripts:

- `official/productivity/twin-telephony`
- `official/creative/twin-realtime`

Their helper scripts expose provider/runtime operations without moving Twin
domain ownership into the workspace app.

These optional skills are execution surfaces for operators and developers. They
should wrap Hermes-owned runtime modules rather than redefine Twin domain logic.

## Stability guidance

If a workspace integration needs a long-lived contract, prefer:

1. `TwinWorkspaceContract`
2. `TwinWorkspaceAPI` / `TwinRealtimeWorkspaceAPI`
3. `skills.twin.workspace_commands`

Avoid binding directly to many internal files under:

- `skills.twin.*`
- `skills.twin._runtime.realtime.*`
- `skills.twin._runtime.telephony.*`

unless you are extending Hermes itself and accept refactor churn.
