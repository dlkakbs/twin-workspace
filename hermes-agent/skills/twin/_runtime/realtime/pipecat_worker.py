from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path
from typing import Any

from .env import merged_runtime_env


def _load_session(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _runtime_env() -> dict[str, str]:
    return merged_runtime_env()


def _realtime_llm_credentials(env: dict[str, str]) -> tuple[str, str, str]:
    return (
        env.get("OPENAI_API_KEY", ""),
        env.get("OPENAI_BASE_URL") or "https://api.openai.com/v1",
        env.get("TWIN_OPENAI_REALTIME_MODEL", "gpt-4.1-mini"),
    )


def _build_services(session_payload: dict[str, Any]) -> dict[str, Any]:
    env = _runtime_env()
    profile = session_payload.get("compiled_context") or {}
    prompt = str(profile.get("prompt") or "")
    language = str(profile.get("language") or "tr-TR").strip().lower()
    if language.startswith("tr"):
        stt_language = "tr"
    elif language.startswith("en"):
        stt_language = "en"
    else:
        stt_language = "multi"

    from pipecat.services.deepgram.stt import DeepgramSTTService
    from pipecat.services.elevenlabs.tts import ElevenLabsTTSService
    from pipecat.services.openai.llm import OpenAILLMService

    llm_api_key, llm_base_url, llm_model = _realtime_llm_credentials(env)

    stt = DeepgramSTTService(
        api_key=env.get("DEEPGRAM_API_KEY", ""),
        settings=DeepgramSTTService.Settings(
            language=stt_language,
            model="nova-3-general",
            interim_results=True,
            smart_format=True,
            punctuate=True,
        ),
    )
    llm = OpenAILLMService(
        api_key=llm_api_key,
        base_url=llm_base_url,
        settings=OpenAILLMService.Settings(
            model=llm_model,
            temperature=0.2,
            system_instruction=prompt,
        ),
    )
    tts = ElevenLabsTTSService(
        api_key=env.get("ELEVENLABS_API_KEY", ""),
        settings=ElevenLabsTTSService.Settings(
            voice=env.get("ELEVENLABS_VOICE_ID", ""),
            model=env.get("TWIN_ELEVENLABS_TTS_MODEL", "eleven_multilingual_v2"),
            stability=0.3,
            similarity_boost=0.86,
            speed=0.94,
        ),
    )
    return {"stt": stt, "llm": llm, "tts": tts}


def _build_transport(session_payload: dict[str, Any]):
    livekit = ((session_payload.get("runtime") or {}).get("runner_plan") or {}).get("livekit") or {}
    if not livekit or livekit.get("status") != "configured":
        return None

    from pipecat.transports.livekit.transport import LiveKitParams, LiveKitTransport

    return LiveKitTransport(
        url=str(livekit["url"]),
        token=str(livekit["bot_token"]),
        room_name=str(livekit["room_name"]),
        params=LiveKitParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
            audio_in_sample_rate=16000,
            audio_out_sample_rate=24000,
            audio_in_channels=1,
            audio_out_channels=1,
            audio_in_passthrough=True,
        ),
    )


def build_config(session_payload: dict[str, Any]) -> dict[str, Any]:
    env = _runtime_env()
    prompt = str(((session_payload.get("compiled_context") or {}).get("prompt") or "")).strip()
    runner_plan = ((session_payload.get("runtime") or {}).get("runner_plan") or {})
    livekit = runner_plan.get("livekit") or {}
    return {
        "session_id": session_payload.get("video_session_id"),
        "title": session_payload.get("title"),
        "counterpart_name": session_payload.get("counterpart_name"),
        "stt_provider": "deepgram",
        "llm_provider": "openai",
        "tts_provider": "elevenlabs",
        "avatar_provider": "heygen-liveavatar-lite",
        "prompt_preview": prompt[:400],
        "livekit_status": livekit.get("status", "not_configured"),
        "livekit_room_name": livekit.get("room_name"),
        "missing_env": [
            key for key in ["DEEPGRAM_API_KEY", "OPENAI_API_KEY", "ELEVENLABS_API_KEY", "LIVEAVATAR_API_KEY", "LIVEAVATAR_AVATAR_ID"] if not env.get(key)
        ],
    }


def _build_pipeline(session_payload: dict[str, Any]):
    from pipecat.frames.frames import EndFrame, TTSSpeakFrame
    from pipecat.pipeline.pipeline import Pipeline
    from pipecat.pipeline.runner import PipelineRunner
    from pipecat.pipeline.task import PipelineParams, PipelineTask
    from pipecat.processors.aggregators.llm_response import (
        LLMAssistantContextAggregator,
        LLMUserContextAggregator,
    )
    from pipecat.processors.aggregators.openai_llm_context import OpenAILLMContext

    services = _build_services(session_payload)
    transport = _build_transport(session_payload)
    if transport is None:
        raise RuntimeError("LiveKit transport is not configured. Add LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET.")
    prompt = str(((session_payload.get("compiled_context") or {}).get("prompt") or "")).strip()
    context = OpenAILLMContext(messages=[{"role": "system", "content": prompt}] if prompt else [])
    user_ctx = LLMUserContextAggregator(context)
    assistant_ctx = LLMAssistantContextAggregator(context)
    pipeline = Pipeline([
        transport.input(),
        services["stt"],
        user_ctx,
        services["llm"],
        services["tts"],
        transport.output(),
        assistant_ctx,
    ])
    task = PipelineTask(
        pipeline,
        params=PipelineParams(
            audio_in_sample_rate=16000,
            audio_out_sample_rate=24000,
            enable_metrics=True,
            enable_usage_metrics=True,
        ),
    )
    guest_disconnect_task: asyncio.Task[None] | None = None
    guest_greeted = False

    def is_guest_participant(participant_id: object) -> bool:
        return str(participant_id or "").startswith("guest-")

    preferred_opener = str(((session_payload.get("compiled_context") or {}).get("preferred_opener") or "")).strip()
    opening_line = preferred_opener or "Merhaba."

    @transport.event_handler("on_participant_left")
    async def on_participant_left(transport_obj, participant_id, reason):
        nonlocal guest_disconnect_task
        if not is_guest_participant(participant_id):
            return

        async def close_after_grace_period() -> None:
            await asyncio.sleep(20)
            await task.queue_frame(EndFrame())

        if guest_disconnect_task and not guest_disconnect_task.done():
            guest_disconnect_task.cancel()
        guest_disconnect_task = asyncio.create_task(close_after_grace_period())

    @transport.event_handler("on_participant_connected")
    async def on_participant_connected(transport_obj, participant_id):
        nonlocal guest_disconnect_task, guest_greeted
        if not is_guest_participant(participant_id):
            return
        if guest_disconnect_task and not guest_disconnect_task.done():
            guest_disconnect_task.cancel()
            guest_disconnect_task = None
        if not guest_greeted:
            guest_greeted = True
            await task.queue_frame(TTSSpeakFrame(opening_line))

    runner = PipelineRunner(handle_sigint=False)
    return runner, task


async def _run_worker(session_payload: dict[str, Any]) -> None:
    runner, task = _build_pipeline(session_payload)
    await runner.run(task)


def main() -> int:
    parser = argparse.ArgumentParser(description="Twin Pipecat worker")
    parser.add_argument("--session-file", required=True)
    parser.add_argument("--check-only", action="store_true")
    args = parser.parse_args()
    session_file = Path(args.session_file).expanduser().resolve()
    if not session_file.exists():
        print(json.dumps({"ok": False, "error": f"Session file not found: {session_file}"}))
        return 1
    session_payload = _load_session(session_file)
    config = build_config(session_payload)
    if args.check_only:
        try:
            services = _build_services(session_payload)
            transport = _build_transport(session_payload)
            print(json.dumps({
                "ok": True,
                "mode": "check_only",
                "config": config,
                "services": {
                    "stt": services["stt"].__class__.__name__,
                    "llm": services["llm"].__class__.__name__,
                    "tts": services["tts"].__class__.__name__,
                    "transport": transport.__class__.__name__ if transport else None,
                },
            }, ensure_ascii=False, indent=2))
            return 0
        except Exception as exc:
            print(json.dumps({"ok": False, "mode": "check_only", "config": config, "error": str(exc)}, ensure_ascii=False, indent=2))
            return 1
    try:
        asyncio.run(_run_worker(session_payload))
        return 0
    except Exception as exc:
        print(json.dumps({"ok": False, "mode": "run", "config": config, "error": str(exc)}, ensure_ascii=False, indent=2))
        return 1


if __name__ == "__main__":
    sys.exit(main())
