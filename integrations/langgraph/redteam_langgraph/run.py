"""CLI entry point for the LangGraph deployment target."""

from __future__ import annotations

import argparse
from pathlib import Path

from .builder import build_graph, compiled_topology
from .graph_spec import load_graph_spec


def main() -> int:
    parser = argparse.ArgumentParser(description="Build or run the Azure red-team LangGraph target.")
    parser.add_argument("--graph", default="graph/redteam.graph.json", help="Repo-relative graph spec path")
    parser.add_argument("--dry-run", action="store_true", default=True, help="Print compiled topology without executing nodes")
    args = parser.parse_args()

    spec = load_graph_spec(args.graph)
    compiled = build_graph(Path(args.graph))
    topology = compiled_topology(compiled)
    print(f"{spec.name}@{spec.version} compiled")
    print("Nodes:")
    for node in topology["nodes"]:
        print(f"  - {node}")
    print("Edges:")
    for source, target in topology["edges"]:
        print(f"  - {source} -> {target}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
