from __future__ import annotations

from pathlib import Path


def main() -> int:
    import config
    import env_utils
    import hermes_imports
    import storage_reader
    import twin_bridge
    import video_session_manager
    import workspace_paths
    from routes import calls, delegations, profile, settings, twilio

    contract = env_utils.twin_workspace_contract()
    assert contract.profile_path == workspace_paths.PROFILE_JSON
    assert contract.output_root == workspace_paths.HERMES_OUTPUTS
    assert workspace_paths.DELEGATIONS_DIR.parent == workspace_paths.HERMES_OUTPUTS / "delegations"
    assert workspace_paths.RUNS_DIR.parent == workspace_paths.HERMES_OUTPUTS / "runs"
    assert config.PROFILE_JSON == workspace_paths.PROFILE_JSON
    assert storage_reader.PROFILE_JSON == workspace_paths.PROFILE_JSON
    assert twin_bridge._workspace_command_args() == contract.workspace_command_args()
    assert hermes_imports.ensure_hermes_import_path(config.HERMES_ROOT) == Path(config.HERMES_ROOT).resolve()

    profile_payload = workspace_paths.read_profile_payload()
    settings_payload = settings.get_settings()
    video_snapshot = video_session_manager.session_debug_snapshot()
    delegations_payload = storage_reader.list_delegations()
    calls_payload = storage_reader.list_all_calls()
    public_view = video_session_manager.public_session_view(
        {
            "status": "started",
            "provider_state": {"liveavatar": "started", "pipecat": "running"},
            "runtime": {
                "runner_status": "running",
                "runner_plan": {
                    "livekit": {
                        "status": "configured",
                        "url": "wss://example.livekit.invalid",
                        "room_name": "room-1",
                        "user_identity": "guest-1",
                        "user_token": "token-1",
                        "bot_token": "bot-secret",
                    }
                },
                "liveavatar_session": {
                    "status": "started",
                    "session_id": "la-1",
                    "ws_url": "wss://liveavatar.invalid/ws",
                    "livekit_client_token": "avatar-secret",
                },
                "worker_process": {"started_at": "2026-04-28T00:00:00Z", "alive": True, "pid": 123},
            },
            "artifacts": {},
        }
    )

    assert isinstance(delegations_payload, list)
    assert isinstance(calls_payload, list)
    assert callable(calls.list_calls)
    assert callable(delegations.list_delegations)
    assert public_view["browser_join"]["status"] == "browser_join_ready"
    assert public_view["browser_join"]["capabilities"]["browser_media_join"] is True
    assert public_view["browser_join"]["artifacts"]["livekit_user_token_present"] is True
    assert public_view["runtime"]["worker_process"] == {
        "started_at": "2026-04-28T00:00:00Z",
        "alive": True,
    }
    assert "bot_token" not in ((public_view["runtime"]["runner_plan"]).get("livekit") or {})
    assert "livekit_client_token" not in (public_view["runtime"]["liveavatar_session"] or {})

    if delegations_payload:
        first_delegation = delegations_payload[0]
        assert "_path" in first_delegation
        assert Path(str(first_delegation["_path"])).exists()

    print(f"contract_profile_path={contract.profile_path}")
    print(f"contract_output_root={contract.output_root}")
    print(f"profile_payload_loaded={bool(profile_payload)}")
    print(f"settings_key_count={len(settings_payload)}")
    print(f"video_snapshot_keys={sorted(video_snapshot.keys())}")
    print(f"browser_join_status={public_view['browser_join']['status']}")
    print(f"delegation_count={len(delegations_payload)}")
    print(f"call_count={len(calls_payload)}")
    print(
        "twilio_helpers_loaded="
        f"{callable(twilio._twilio_request)} {callable(twilio._elevenlabs_request)}"
    )
    print(
        "profile_route_helpers_loaded="
        f"{callable(profile._load_profile_data)} {callable(profile._load_heygen_settings)}"
    )
    print(
        "read_model_routes_loaded="
        f"{callable(calls.list_calls)} {callable(delegations.list_delegations)}"
    )
    print("smoke_status=ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
