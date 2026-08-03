"""Python bridge to the canonical dependency-free Node read-only guard."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any, Literal, TypedDict

from .graph_spec import REPO_ROOT

DecisionValue = Literal["allow", "ask", "deny"]


class GuardDecision(TypedDict):
    decision: DecisionValue
    reason: str


def _deny(reason: str) -> GuardDecision:
    return {"decision": "deny", "reason": reason}


def decide(command: str, cwd: str | Path = ".", tool_name: str = "bash", timeout: float = 10.0) -> GuardDecision:
    """Return the Node guard decision for a command, failing closed on errors."""

    if not isinstance(command, str) or not command.strip():
        return _deny("Red team guardrail received an empty command, so it was blocked (fail-closed).")

    guard_path = REPO_ROOT / "guardrails" / "guard.mjs"
    payload = {"command": command, "cwd": str(cwd), "toolName": tool_name}
    try:
        completed = subprocess.run(
            ["node", str(guard_path)],
            input=json.dumps(payload),
            text=True,
            capture_output=True,
            cwd=str(REPO_ROOT),
            timeout=timeout,
            check=False,
        )
    except Exception as exc:  # noqa: BLE001 - fail-closed bridge boundary
        return _deny(f"Red team guardrail bridge failed closed: {exc}")

    if completed.returncode != 0:
        return _deny("Red team guardrail bridge returned a non-zero exit code, so it was blocked (fail-closed).")

    try:
        parsed: Any = json.loads(completed.stdout.strip())
    except Exception as exc:  # noqa: BLE001
        return _deny(f"Red team guardrail bridge returned unparseable output, so it was blocked (fail-closed): {exc}")

    if not isinstance(parsed, dict) or parsed.get("decision") not in {"allow", "ask", "deny"}:
        return _deny("Red team guardrail bridge returned an invalid decision shape, so it was blocked (fail-closed).")
    return {"decision": parsed["decision"], "reason": str(parsed.get("reason") or "")}


def guarded_run(command: str, cwd: str | Path = ".", tool_name: str = "bash", **kwargs: Any) -> subprocess.CompletedProcess[str]:
    """Run a command only after the shared guard returns allow."""

    decision = decide(command, cwd=cwd, tool_name=tool_name)
    if decision["decision"] != "allow":
        raise PermissionError(decision["reason"] or f"Guard decision: {decision['decision']}")
    return subprocess.run(command, cwd=str(cwd), text=True, shell=True, check=False, **kwargs)
