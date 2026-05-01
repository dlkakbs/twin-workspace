---
name: twin-realtime
description: Optional realtime avatar and video runtime for Twin. Owns LiveAvatar, LiveKit, and Pipecat session orchestration outside the core Twin skill.
version: 0.1.0
author: OpenAI
license: MIT
metadata:
  hermes:
    tags: [twin, realtime, video, liveavatar, livekit, pipecat]
    category: creative
---

# Twin Realtime

This optional skill is the target home for Twin realtime session runtime code.

Scope:

- realtime session lifecycle
- LiveAvatar provider adapter
- LiveKit transport planning
- Pipecat worker orchestration

Non-scope:

- twin profile setup
- delegation domain models
- workspace dashboard ownership

Current status:

- phase-1 extraction in progress from `twin-workspace`
- this skill is a user-facing execution wrapper, not the canonical Twin domain
  owner
- integrations that need stable Twin state mutation should still enter through
  `skills.twin`

Helper script:

- `scripts/twin_realtime.py`

Example usage:

```bash
python3 ~/.hermes/skills/creative/twin-realtime/scripts/twin_realtime.py diagnose
python3 ~/.hermes/skills/creative/twin-realtime/scripts/twin_realtime.py build-runner-plan --session-file /path/to/session.json
python3 ~/.hermes/skills/creative/twin-realtime/scripts/twin_realtime.py stop-liveavatar-session --session-id 20260428_120000
```
