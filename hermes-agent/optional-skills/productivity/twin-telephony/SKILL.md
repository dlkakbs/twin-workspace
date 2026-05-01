---
name: twin-telephony
description: Optional telephony runtime for Twin. Owns outbound call provider setup and execution so the core Twin skill stays provider-agnostic.
version: 0.1.0
author: OpenAI
license: MIT
metadata:
  hermes:
    tags: [twin, telephony, elevenlabs, twilio, outbound-calls]
    category: productivity
---

# Twin Telephony

This optional skill is the target home for Twin telephony runtime code.

Scope:

- provider credential diagnostics
- outbound call runtime selection
- ElevenLabs ConvAI / Twilio integration
- future Vapi / Bland adapters

Non-scope:

- twin profile setup
- twin style generation
- delegation domain models
- workspace UI

Current status:

- phase-1 extraction in progress from `skills/twin`
- this skill is a user-facing execution wrapper, not the canonical Twin domain
  owner
- integrations that need stable Twin state mutation should still enter through
  `skills.twin`

Helper script:

- `scripts/twin_telephony.py`

Example usage:

```bash
python3 ~/.hermes/skills/productivity/twin-telephony/scripts/twin_telephony.py diagnose
python3 ~/.hermes/skills/productivity/twin-telephony/scripts/twin_telephony.py fetch-twilio-call --call-sid CA...
python3 ~/.hermes/skills/productivity/twin-telephony/scripts/twin_telephony.py fetch-conversation --conversation-id conv...
```
