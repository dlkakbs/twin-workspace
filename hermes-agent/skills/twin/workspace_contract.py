from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from hermes_constants import get_hermes_home


@dataclass(frozen=True)
class TwinWorkspaceContract:
    project_root: Path
    output_root: Path
    env_path: Path
    profile_slug: str

    @classmethod
    def from_values(
        cls,
        *,
        project_root: Path,
        output_root: Path | None = None,
        env_path: Path | None = None,
        profile_slug: str | None = None,
    ) -> "TwinWorkspaceContract":
        resolved_project_root = Path(project_root).expanduser().resolve()
        resolved_output_root = Path(
            output_root
            or os.environ.get("TWIN_OUTPUT_ROOT", resolved_project_root / "outputs" / "twin")
        ).expanduser().resolve()
        resolved_env_path = Path(env_path or (get_hermes_home() / ".env")).expanduser().resolve()
        resolved_profile_slug = profile_slug or os.environ.get("TWIN_PROFILE_SLUG", "dilek")
        return cls(
            project_root=resolved_project_root,
            output_root=resolved_output_root,
            env_path=resolved_env_path,
            profile_slug=resolved_profile_slug,
        )

    @property
    def profile_path(self) -> Path:
        return self.output_root / "profiles" / self.profile_slug / "profile.json"

    @property
    def video_sessions_dir(self) -> Path:
        return self.output_root / "video_sessions" / self.profile_slug

    def workspace_command_args(self) -> list[str]:
        return [
            "--project-root",
            str(self.project_root),
            "--output-root",
            str(self.output_root),
            "--env-path",
            str(self.env_path),
            "--profile-slug",
            self.profile_slug,
        ]

    def make_workspace_api(self):
        from .workspace_api import TwinWorkspaceAPI

        return TwinWorkspaceAPI(
            project_root=self.project_root,
            output_root=self.output_root,
            env_path=self.env_path,
            profile_slug=self.profile_slug,
        )

    def make_realtime_workspace_api(
        self,
        *,
        runtime_env_loader: Callable[[], dict[str, str]],
        storage_reader_module: Any,
    ):
        from .realtime_workspace_api import TwinRealtimeWorkspaceAPI

        return TwinRealtimeWorkspaceAPI(
            project_root=self.project_root,
            profile_path=self.profile_path,
            profile_slug=self.profile_slug,
            video_sessions_dir=self.video_sessions_dir,
            runtime_env_loader=runtime_env_loader,
            storage_reader_module=storage_reader_module,
        )
