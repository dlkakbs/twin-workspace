# Twin Workspace

Twin Workspace is a single-repo Twin control surface for the Hermes-backed architecture used in this project.

This repo is intentionally split into two layers:

- `backend/`, `src/`, `start.sh`: the workspace UI and thin backend facade
- `hermes-agent/`: the embedded Hermes Twin owner surface

The ownership model is unchanged:

- Hermes is the owner
- Twin Workspace is the control surface
- telephony and realtime are optional runtime capabilities
- the workspace backend is a thin adapter, not the canonical domain owner

## Repo Layout

```text
.
├── backend/                     # FastAPI facade / adapter
├── src/                         # React + Vite operator UI
├── start.sh                     # starts backend + frontend together
└── hermes-agent/
    ├── hermes_constants.py
    ├── skills/twin/             # canonical Twin owner surface
    ├── optional-skills/productivity/twin-telephony/
    └── optional-skills/creative/twin-realtime/
```

## Requirements

- Node.js 18+
- npm
- Python 3.11+

## 1. Clone This Repo

```bash
git clone <PRIVATE_REPO_URL> twin-workspace
cd twin-workspace
```

This is the only repo you need to clone for the workspace demo surface.

## 2. Hermes Root Path

The workspace backend resolves `HERMES_ROOT` from `backend/.env`.

In this single-repo layout the default already points at the embedded Hermes subtree:

```env
HERMES_ROOT=../hermes-agent
```

So in the normal setup you do not need to change it.

Override it only if you move the Hermes subtree somewhere else.

## 3. Environment Variables

There are two env files:

- `backend/.env`
- `hermes-agent/.env`

### Backend env

```bash
cp backend/.env.example backend/.env
```

Key backend values:

- `HERMES_ROOT`
- `HERMES_OUTPUTS`
- `TWIN_OUTPUT_ROOT`
- `TWIN_PROFILE_SLUG`
- `HERMES_API_SERVER_URL`

### Hermes env

```bash
cp hermes-agent/.env.example hermes-agent/.env
```

Provider env groups:

- `KIMI_API_KEY`, `KIMI_BASE_URL`
- `OPENAI_API_KEY`, `OPENAI_BASE_URL`
- `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, `ELEVENLABS_AGENT_ID`, `ELEVENLABS_PHONE_NUMBER_ID`
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`
- `HEYGEN_API_KEY`
- `LIVEAVATAR_API_KEY`, `LIVEAVATAR_AVATAR_ID`
- `DEEPGRAM_API_KEY`
- `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`
- `TWIN_PUBLIC_BASE_URL`

You do not need every provider for every flow:

- content-only: Kimi/OpenAI plus ElevenLabs if you want audio
- outbound voice: ElevenLabs + Twilio
- avatar video: HeyGen and/or LiveAvatar depending on the path you use
- realtime video: Deepgram + ElevenLabs + LiveKit + LiveAvatar

## 4. Install And Start Workspace

### Frontend

```bash
npm install
```

### Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cd ..
```

### Embedded Hermes Twin surface

The embedded Hermes subtree is imported directly from source by the workspace backend.

Install the minimal Twin Python dependencies:

```bash
cd hermes-agent
python -m venv .venv
source .venv/bin/activate
pip install -r requirements-twin.txt
cd ..
```

Create the output directory once:

```bash
mkdir -p hermes-agent/outputs/twin
```

### Start both servers

```bash
bash ./start.sh
```

This starts:

- frontend: `http://localhost:5175`
- backend: `http://localhost:8000`

## 5. Prepare A Twin Profile

Twin state is stored under:

- `hermes-agent/outputs/twin/profiles/<slug>/profile.json`

Default slug:

- `dilek`

The workspace expects a Twin profile to exist before voice, content, or realtime flows can fully work.

Minimum practical setup:

1. set `TWIN_PROFILE_SLUG` in both env files if you want a slug other than `dilek`
2. create the Twin profile JSON under `hermes-agent/outputs/twin/profiles/<slug>/profile.json`
3. place profile assets such as the photo in `hermes-agent/outputs/twin/profiles/<slug>/assets/`
4. fill voice/avatar/provider IDs in the profile and env files as needed

The embedded Hermes owner surface lives here:

- `hermes-agent/skills/twin/`
- `hermes-agent/skills/twin/WORKSPACE_INTEGRATION.md`
- `hermes-agent/skills/twin/workspace_contract.py`
- `hermes-agent/skills/twin/workspace_api.py`
- `hermes-agent/skills/twin/workspace_commands.py`

## 6. Telephony And Realtime Are Optional

Not every setup needs live calling or realtime video.

Optional runtime surfaces included in this repo:

- `hermes-agent/optional-skills/productivity/twin-telephony/`
- `hermes-agent/optional-skills/creative/twin-realtime/`

Use them when you need:

- Twilio + ElevenLabs outbound calling
- LiveAvatar / LiveKit / Pipecat-style realtime sessions

If you only want the workspace UI and non-realtime content flows, you can leave those provider env values unset.

## What Lives Where

Hermes-owned surface:

- `hermes-agent/skills/twin/`
- `hermes-agent/skills/twin/_runtime/`

Workspace-owned surface:

- `backend/routes/*`
- `backend/twin_bridge.py`
- `backend/delegations_facade.py`
- `src/`

Compatibility shims inside workspace:

- `backend/content_run_worker.py`
- `backend/scheduled_call_logger.py`
- `backend/pipecat_worker.py`

## Notes

- This repo is not a standalone frontend-only product.
- The workspace backend depends on the embedded Hermes Twin surface.
- `outputs/`, `.env`, local logs, and generated media are intentionally excluded from git.
