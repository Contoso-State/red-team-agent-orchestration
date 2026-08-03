"""Methodology memory persistence with a hard guardrail namespace firewall."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .graph_spec import REPO_ROOT

GUARDRAIL_NAMESPACES = {"guardrails", "allowlist", "egress", "readonly", "guard"}
METHODOLOGY_NAMESPACE = "methodology"


class MemoryFirewallError(PermissionError):
    """Raised when a write attempts to target a protected namespace."""


class MethodologyMemory:
    """File-backed procedural memory constrained to the methodology namespace."""

    def __init__(self, root: str | Path | None = None) -> None:
        self.root = Path(root) if root is not None else REPO_ROOT / "memory"

    def _namespace_path(self, namespace: str) -> Path:
        clean = namespace.replace("\\", "/").strip("/")
        top = clean.split("/", 1)[0]
        if top in GUARDRAIL_NAMESPACES or clean != METHODOLOGY_NAMESPACE:
            raise MemoryFirewallError(
                f"memory namespace '{namespace}' is blocked; self-improvement may only write methodology"
            )
        return self.root / METHODOLOGY_NAMESPACE

    def read(self, namespace: str = METHODOLOGY_NAMESPACE) -> dict[str, Any]:
        path = self._namespace_path(namespace)
        events_path = path / "events.jsonl"
        events: list[Any] = []
        if events_path.exists():
            with events_path.open("r", encoding="utf-8") as handle:
                for line in handle:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        events.append(json.loads(line))
                    except json.JSONDecodeError:
                        events.append({"raw": line})
        return {"namespace": METHODOLOGY_NAMESPACE, "events": events}

    def write(self, record: dict[str, Any], namespace: str = METHODOLOGY_NAMESPACE) -> Path:
        path = self._namespace_path(namespace)
        path.mkdir(parents=True, exist_ok=True)
        event = {"written_at": datetime.now(timezone.utc).isoformat(), **record}
        events_path = path / "events.jsonl"
        with events_path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(event, sort_keys=True, default=str) + "\n")
        return events_path
