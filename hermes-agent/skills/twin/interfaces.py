from __future__ import annotations

from typing import Any, Protocol

from .models import DelegationTask, TwinProfile


class TwinTelephonyRuntime(Protocol):
    """Provider runtime for outbound voice delegation."""

    def validate(self) -> None:
        """Raise when the configured runtime cannot place calls."""

    def run_outbound_call(
        self,
        *,
        twin: TwinProfile,
        task: DelegationTask,
        prompt: str,
        first_message: str,
    ) -> dict[str, Any]:
        """Configure the provider and start an outbound call."""

