---
name: twin
title: Twin
description: Build a local digital twin from a photo, voice sample, and writing samples, then generate style-matched scripts, cloned-voice audio, optional talking-avatar video, and delegated call workflows.
version: 0.1.0
author: OpenAI
license: MIT
required_environment_variables:
  - name: OPENAI_API_KEY
    prompt: Enter your OpenAI API key
    help: Get it from https://platform.openai.com/
    required_for: style profile extraction and script generation
  - name: ELEVENLABS_API_KEY
    prompt: Enter your ElevenLabs API key
    help: Get it from https://elevenlabs.io/
    required_for: voice cloning, narration, and live calling
  - name: HEYGEN_API_KEY
    prompt: Enter your HeyGen API key
    help: Get it from https://app.heygen.com/
    required_for: talking-avatar video generation with HeyGen
setup:
  help: Twin is the canonical implementation for the local digital twin workflow.
metadata:
  hermes:
    tags: [digital-twin, delegation, voice-delegate, twin, openai, elevenlabs, heygen]
    category: creative
    requires_toolsets: [terminal]
    related_optional_skills: [twin-telephony, twin-realtime]
---

# Twin

`Twin` is the canonical skill for creating a local digital twin and running
delegated voice, video, and content workflows.

Example commands:

```bash
python -m skills.twin setup \
  --name "Example User" \
  --photo /path/to/photo.jpg \
  --voice /path/to/voice.mp3 \
  --writing-sample /path/to/sample1.md \
  --writing-sample /path/to/sample2.pdf

python -m skills.twin delegate-create \
  --profile outputs/twin/profiles/example-user/profile.json \
  --task-type restaurant_inquiry \
  --counterpart-name "Example Restaurant" \
  --counterpart-phone "+15551234567" \
  --goal "Ask about lighter menu options, estimated delivery time, and the approximate total price."

python -m skills.twin call-run \
  --delegation /path/to/delegation.json
```

Preferred command path:

- `skills.twin` is the preferred command path going forward

Workspace integration:

- The preferred Hermes-side integration contract is `skills.twin.TwinWorkspaceContract`
- Use `skills.twin.TwinWorkspaceAPI` and `skills.twin.TwinRealtimeWorkspaceAPI`
  as the main workspace-facing facades
- For detached or cron-safe execution, use:
  `python -m skills.twin.workspace_commands ...`
- Workspace or dashboard repos should integrate through this contract rather
  than owning Twin state directly

Optional runtime skills:

```bash
hermes skills install official/productivity/twin-telephony
hermes skills install official/creative/twin-realtime
```

These provide provider/runtime helper scripts while keeping Twin profile,
delegation, content, and call state owned by `skills.twin`.

Ownership split:

- `skills.twin` owns Twin profile, delegation, content, and call state
- optional skills expose telephony and realtime execution helpers
- workspace apps act as control surfaces, not canonical domain owners

Reference:

- `skills/twin/WORKSPACE_INTEGRATION.md`
