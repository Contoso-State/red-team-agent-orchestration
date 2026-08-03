"""Load and expose typed accessors for graph/redteam.graph.json."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping, Sequence

REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_GRAPH_PATH = REPO_ROOT / "graph" / "redteam.graph.json"


@dataclass(frozen=True)
class GraphSpec:
    """Parsed canonical red-team graph specification."""

    path: Path
    data: Mapping[str, Any]

    @property
    def name(self) -> str:
        return str(self.data["name"])

    @property
    def version(self) -> str:
        return str(self.data["version"])

    @property
    def params(self) -> Mapping[str, Any]:
        return self.data.get("params", {})

    @property
    def channels(self) -> Mapping[str, Mapping[str, Any]]:
        return self.data.get("state", {}).get("channels", {})

    @property
    def reducers(self) -> dict[str, str]:
        return {name: str(meta.get("reducer", "last")) for name, meta in self.channels.items()}

    @property
    def nodes(self) -> Sequence[Mapping[str, Any]]:
        return self.data.get("nodes", [])

    @property
    def node_ids(self) -> list[str]:
        return [str(node["id"]) for node in self.nodes]

    @property
    def node_by_id(self) -> dict[str, Mapping[str, Any]]:
        return {str(node["id"]): node for node in self.nodes}

    @property
    def edges(self) -> Sequence[Mapping[str, str]]:
        return self.data.get("edges", [])

    @property
    def conditional_edges(self) -> Sequence[Mapping[str, Any]]:
        return self.data.get("conditional_edges", [])

    @property
    def roster(self) -> Sequence[Mapping[str, Any]]:
        return self.data.get("roster", [])

    def conditional_from(self, node_id: str) -> Mapping[str, Any] | None:
        for edge in self.conditional_edges:
            if edge.get("from") == node_id:
                return edge
        return None

    def start_node(self) -> str:
        for edge in self.edges:
            if edge.get("from") == "START":
                return str(edge["to"])
        raise ValueError("graph has no START edge")


def resolve_repo_path(path: str | Path | None = None) -> Path:
    """Resolve a repo-relative path against the repository root."""

    if path is None:
        return DEFAULT_GRAPH_PATH
    candidate = Path(path)
    if candidate.is_absolute():
        return candidate
    return REPO_ROOT / candidate


def load_graph_spec(path: str | Path | None = None) -> GraphSpec:
    """Load the canonical graph JSON from a repo-relative or absolute path."""

    graph_path = resolve_repo_path(path)
    with graph_path.open("r", encoding="utf-8") as handle:
        data = json.load(handle)
    return GraphSpec(path=graph_path, data=data)
