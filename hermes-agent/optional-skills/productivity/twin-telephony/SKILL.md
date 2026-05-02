---
name: twin-telephony
description: Optional telephony runtime for Twin. Owns outbound call setup, outbound SMS delivery, and provider execution so the core Twin skill stays provider-agnostic.
version: 0.1.0
author: OpenAI
license: MIT
metadata:
  hermes:
    tags: [twin, telephony, elevenlabs, twilio, outbound-calls, outbound-sms]
    category: productivity
---

# Twin Telephony

This optional skill is the target home for Twin telephony runtime code.

Today it is centered on outbound execution:

- outbound voice calls through ElevenLabs ConvAI + Twilio
- outbound SMS delivery used for Twin invite and follow-up messaging
- provider diagnostics and runtime helpers shared by the workspace bridge

Scope:

- provider credential diagnostics
- outbound call runtime selection
- outbound SMS delivery helpers
- ElevenLabs ConvAI / Twilio integration
- future Vapi / Bland adapters

Non-scope:

- inbound call answering
- inbound SMS handling
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
- inbound capability flags may appear in provider metadata, but Twin does not
  currently expose a first-class inbound call or inbound messaging workflow here

Helper script:

- `scripts/twin_telephony.py`

Example usage:

```bash
python3 ~/.hermes/skills/productivity/twin-telephony/scripts/twin_telephony.py diagnose
python3 ~/.hermes/skills/productivity/twin-telephony/scripts/twin_telephony.py fetch-twilio-call --call-sid CA...
python3 ~/.hermes/skills/productivity/twin-telephony/scripts/twin_telephony.py fetch-conversation --conversation-id conv...
```
