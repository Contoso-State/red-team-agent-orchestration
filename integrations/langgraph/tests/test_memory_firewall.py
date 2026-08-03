import shutil
from pathlib import Path

import pytest

from redteam_langgraph.memory import MemoryFirewallError, MethodologyMemory


def test_memory_firewall_only_allows_methodology_namespace():
    root = Path(__file__).resolve().parents[1] / ".test-memory"
    if root.exists():
        shutil.rmtree(root)
    memory = MethodologyMemory(root=root)
    try:
        path = memory.write({"kind": "test"}, namespace="methodology")
        assert path.exists()
        assert path.parent.name == "methodology"

        for namespace in ["guardrails", "allowlist", "egress", "readonly", "guard", "methodology/../guardrails"]:
            with pytest.raises(MemoryFirewallError):
                memory.write({"kind": "blocked"}, namespace=namespace)
    finally:
        if root.exists():
            shutil.rmtree(root)
