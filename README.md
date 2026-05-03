### Twin Workspace

Twin Workspace is the control surface for running a real digital twin on top of Hermes.

It lets you create, schedule, and run real-world interactions using your own voice, avatar, and persona. The workspace is where you define intent, review state, and manage execution. Hermes owns the runtime and orchestration underneath.

## What is Twin?

Twin is a programmable identity that can:

- make outbound voice calls
- host realtime and video sessions
- generate content across video, audio, and scripts
- execute tasks through a delegation model

Everything is modeled as a task and managed through a single workspace.

Twin is designed to:

- represent you in communication
- automate recurring real-world interactions
- maintain a consistent identity across tasks and channels

## Why it exists

Many interactions are simple in theory but costly in practice.

Things like:

- making quick calls
- checking availability
- asking for pricing
- confirming bookings
- handling follow-ups
- joining a video conversation

These tasks require timing, attention, and the right headspace. Because of that, they often get delayed, skipped, or handled inefficiently.

They matter, but they do not always require your direct involvement.

Twin is built to take ownership of this layer: generating what needs to be said, scheduling the interaction at the right time, and executing it on your behalf.

You define the intent once. Twin executes it.

## Personal vs Assistant Mode

Before using Twin, you need to configure the core identity and communication setup.

This includes:

- setting up a Twilio phone number (either purchasing one or verifying your own number)
- cloning your voice in ElevenLabs or selecting an existing voice ID
- creating your own avatar in LiveAvatar or using a different avatar ID

Once configured, you can define how your Twin behaves:

- interaction style (formal, casual, concise, etc.)
- tone and communication preferences
- boundaries (what it should or should not say)
- authority rules (what it can act on autonomously)

Twin can then operate in two distinct modes depending on how you want it to represent you:

- **Personal mode**: Twin uses your cloned voice and LiveAvatar, and speaks as you  
- **Assistant mode**: Twin represents you while speaking with its own configured identity  

In assistant mode, this means you can use:

- a different ElevenLabs voice
- a different LiveAvatar
- a different Twilio phone number
- a separate assistant persona

This is useful when you do not want Twin to sound exactly like you, but still want it to make calls, join video sessions, or handle delegated tasks on your behalf.

## Core idea

- Hermes is the owner and orchestration layer
- Twin Workspace is the control surface
- Twin runtime and execution live inside Hermes
- profile, delegation, content, call, and session state stay Hermes-owned

## Architecture

```text
+------------------------------------------------------+
|                  Twin Workspace                      |
|         Hermes operator cockpit / control plane      |
|            React + Vite UI + FastAPI facade          |
+-------------------------+----------------------------+
                          |
                          | drives / manages
                          v
+------------------------------------------------------+
|                    skills/twin                       |
|           Twin core skill inside Hermes              |
|      brain + contract + canonical Twin logic         |
|  identity, profile, delegations, approvals,          |
|  call/video/content orchestration, workspace state   |
+-------------------------+----------------------------+
                          |
              +-----------+-----------+
              |                       |
executes calls|                       | executes live video/avatar
              v                       v
+---------------------------+   +---------------------------+
|   twin-telephony runtime  |   |   twin-realtime runtime   |
| optional Hermes runtime   |   | optional Hermes runtime   |
| Twilio + ElevenLabs       |   | LiveAvatar + LiveKit/STT  |
+---------------------------+   +---------------------------+
                              |
                              v
+------------------------------------------------------+
|              Hermes-owned Twin outputs               |
|     profiles / delegations / runs / video_sessions   |
+------------------------------------------------------+
```

## Requirements

- Node.js 18+
- npm
- Python 3.11+

## Clone

```bash
git clone <PRIVATE_REPO_URL> twin-workspace
cd twin-workspace
```

This workspace expects a Hermes-backed Twin surface.

If this repo includes an embedded `hermes-agent/` subtree, you do not need to clone Hermes separately. If it does not, set `HERMES_ROOT` in `backend/.env` to your existing Hermes checkout.

## Environment

Create the backend env file:

```bash
cp backend/.env.example backend/.env
```

### Key Backend Values

| Variable | Required | Purpose |
|---|---:|---|
| `HERMES_ROOT` | Yes | Path to the Hermes checkout or embedded Hermes subtree |
| `HERMES_OUTPUTS` | Yes | Hermes Twin outputs root |
| `TWIN_OUTPUT_ROOT` | Yes | Twin output root used by the workspace contract |
| `TWIN_PROFILE_SLUG` | Yes | Active Twin profile slug |
| `HERMES_API_SERVER_URL` | Yes | Hermes API server used for sign-in verification |
| `TWIN_SUMMARY_LANGUAGE` | No | Summary/output language for call logging flows |

In the embedded-repo layout, the default is:

```env
HERMES_ROOT=../hermes-agent
```

Only change it if Hermes lives somewhere else.

If the repo includes `hermes-agent/.env.example`, also create the Hermes env file:

```bash
cp hermes-agent/.env.example hermes-agent/.env
```

### Provider Configuration By Flow

| Flow | Required Variables | Notes |
|---|---|---|
| Basic workspace / profile / delegations | `TWIN_PROFILE_SLUG` | Core workspace flows can load without every provider enabled |
| Content: script/text generation | `OPENAI_API_KEY` | OpenAI is required for generated text flows |
| Content: audio narration | `OPENAI_API_KEY`, `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID` | OpenAI writes the script, ElevenLabs generates spoken audio |
| Content: avatar video via HeyGen | `OPENAI_API_KEY`, `HEYGEN_API_KEY`, `HEYGEN_AVATAR_ID` or `HEYGEN_AVATAR_GROUP_ID`, `HEYGEN_VOICE_ID` | Use when Twin should generate avatar-based video output |
| Outbound voice calling | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`, `ELEVENLABS_API_KEY`, `ELEVENLABS_AGENT_ID`, `ELEVENLABS_PHONE_NUMBER_ID` | Powers the Twin telephony runtime |
| Realtime avatar / live video sessions | `OPENAI_API_KEY`, `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEAVATAR_API_KEY`, `LIVEAVATAR_AVATAR_ID`, `DEEPGRAM_API_KEY`, `ELEVENLABS_API_KEY` | Powers the Twin realtime runtime |
| External guest video invites | `TWIN_PUBLIC_BASE_URL` | Must be a public HTTPS URL, not localhost |

### Voice And Avatar IDs

These IDs do not serve the same purpose.

| Value | Used For |
|---|---|
| `ELEVENLABS_VOICE_ID` | Twin's canonical speaking voice for audio narration, realtime speech, and telephony |
| `HEYGEN_VOICE_ID` | HeyGen-specific voice selection for avatar video generation |
| `HEYGEN_AVATAR_ID` | The HeyGen avatar used for generated videos |
| `HEYGEN_AVATAR_GROUP_ID` | The HeyGen avatar group associated with that avatar |
| `LIVEAVATAR_AVATAR_ID` | The avatar used by the realtime LiveAvatar runtime |

Notes:

- `ELEVENLABS_VOICE_ID` is the main speech identity for Twin.
- `HEYGEN_VOICE_ID` does not replace ElevenLabs voice in telephony or narration flows.
- `HEYGEN_*` values are specific to HeyGen video generation.
- `LIVEAVATAR_AVATAR_ID` is only for the realtime avatar runtime.

## Public Base URL For Video Sessions

If you want external guests to join Twin video sessions, the workspace must be reachable through a public URL.

Set:

```env
TWIN_PUBLIC_BASE_URL=https://your-public-url.example.com
```

This base URL is used when Twin generates external video invite links.

For local development, this usually means exposing the workspace through a tunnel such as:

- ngrok
- Cloudflare Tunnel
- another HTTPS public tunnel

Example:

```env
TWIN_PUBLIC_BASE_URL=https://my-workspace-tunnel.ngrok-free.app
```

Notes:

- localhost URLs will not work for external guest invites
- the public URL should point to the workspace surface that serves the join flow
- local self-test flows do not require a public URL

## Install

Install frontend dependencies:

```bash
npm install
```

Create one Python environment for the workspace backend and Hermes Twin surface together:

```bash
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
pip install -r hermes-agent/requirements-twin.txt
```

Create the Twin outputs root once:

```bash
mkdir -p hermes-agent/outputs/twin
```

## Start

Start both servers from the same active Python environment:

```bash
source .venv/bin/activate
bash ./start.sh
```

This starts:

- frontend: `http://localhost:5175`
- backend: `http://localhost:8000`

## Twin Profile

Twin state is resolved through the Hermes workspace contract and stored under the Twin outputs root.

At minimum, set a profile slug and ensure a profile exists for it.

Typical location:

- `hermes-agent/outputs/twin/profiles/<slug>/profile.json`

Set the same `TWIN_PROFILE_SLUG` in your env configuration and use that profile for workspace flows.

## Runtime Capabilities

Twin core lives in Hermes under:

- `hermes-agent/skills/twin/`

Runtime surfaces live under:

- `hermes-agent/optional-skills/productivity/twin-telephony/`
- `hermes-agent/optional-skills/creative/twin-realtime/`

These are required for live calling and realtime/avatar execution.

## What Lives Where

Hermes-owned Twin core:

- `hermes-agent/skills/twin/`

Workspace control surface:

- `src/`
- `backend/routes/*`
- `backend/twin_bridge.py`
- `backend/delegations_facade.py`

## Notes

- This is not a standalone frontend-only app.
- The workspace backend depends on the Hermes Twin surface.
- Start the stack with the Python environment activated so backend and Hermes imports resolve in the same runtime.
