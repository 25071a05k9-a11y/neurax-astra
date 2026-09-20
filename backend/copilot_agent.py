"""Compatibility boundary for the retired rule-based copilot.

The production agent now lives in ``frontend/agent_server.mjs`` and resolves
all evidence through the persisted batch API. The former implementation in
this module manufactured placeholder images and confidence values when data
was missing, so it is deliberately unavailable rather than silently returning
unsupported evidence.
"""

from __future__ import annotations


class IndustrialCopilotAgent:
    """Fail clearly for callers still wired to the retired Python agent."""

    def __init__(self, *args: object, **kwargs: object) -> None:
        del args, kwargs
        raise RuntimeError(
            "The legacy Python copilot has been retired. Use the agent server "
            "and /api/batches/{batch_id}/analysis so answers are grounded in "
            "persisted inspection evidence."
        )
