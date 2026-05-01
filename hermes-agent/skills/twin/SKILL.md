---
name: twin
title: Twin
description: Build a local digital twin from a photo, voice sample, and writing samples, then generate style-matched scripts, cloned-voice audio, optional talking-avatar video, and delegated call workflows.
version: 0.1.0
author: OpenAI
license: MIT
required_environment_variables:
  - name: KIMI_API_KEY
    prompt: Enter your Kimi API key
    help: Get it from https://platform.kimi.ai/
    required_for: style profile extraction and script generation
  - name: ELEVENLABS_API_KEY
    prompt: Enter your ElevenLabs API key
    help: Get it from https://elevenlabs.io/
    required_for: voice cloning, narration, and live calling
  - name: DID_API_KEY
    prompt: Enter your D-ID API key
    help: Get it from https://studio.d-id.com/
    required_for: talking-avatar video generation
  - name: HEYGEN_API_KEY
    prompt: Enter your HeyGen API key
    help: Get it from https://app.heygen.com/
    required_for: talking-avatar video generation with HeyGen
setup:
  help: Twin is the canonical implementation for the local digital twin workflow.
metadata:
  hermes:
    tags: [digital-twin, delegation, voice-delegate, twin, kimi, elevenlabs, heygen]
    category: creative
    requires_toolsets: [terminal]
    related_optional_skills: [twin-telephony, twin-realtime]
---

# Twin

`Twin` is the canonical package name for the digital twin and delegated-calling skill.

You can invoke it as:

```bash
python -m skills.twin setup \
  --name "Dilek" \
  --photo /path/to/photo.jpg \
  --voice /path/to/voice.mp3 \
  --writing-sample /path/to/sample1.md \
  --writing-sample /path/to/sample2.pdf

python -m skills.twin delegate-create \
  --profile outputs/twin/profiles/dilek/profile.json \
  --task-type restaurant_inquiry \
  --counterpart-name "Example Restaurant" \
  --counterpart-phone "+15551234567" \
  --goal "Hafif yemek seçeneklerini, tahmini teslim süresini ve yaklaşık toplam tutarı öğren."

python -m skills.twin call-run \
  --delegation /path/to/delegation.json
```

Canonical note:

- `skills.twin` is the preferred command path going forward

Workspace integration note:

- The preferred Hermes-side integration contract is `skills.twin.TwinWorkspaceContract`
- Facades:
  - `skills.twin.TwinWorkspaceAPI`
  - `skills.twin.TwinRealtimeWorkspaceAPI`
- Detached/cron-safe command surface:
  - `python -m skills.twin.workspace_commands ...`
- Workspace or dashboard repos should consume Twin through this contract rather
  than treating frontend or backend app code as the owner

Optional runtime skills:

```bash
hermes skills install official/productivity/twin-telephony
hermes skills install official/creative/twin-realtime
```

These provide provider/runtime helper scripts while keeping Twin domain
ownership in `skills.twin`.

Owner split:

- `skills.twin` owns Twin profile/delegation/content/call state
- optional skills expose telephony and realtime execution helpers
- workspace apps are control surfaces, not canonical domain owners

Reference:

- `skills/twin/WORKSPACE_INTEGRATION.md`
