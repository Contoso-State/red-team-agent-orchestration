import pytest

pytest.importorskip("langgraph")

from redteam_langgraph.builder import build_graph, compiled_topology
from redteam_langgraph.graph_spec import load_graph_spec

START_ALIASES = {"START", "__start__"}
END_ALIASES = {"END", "__end__"}


def norm(value: str) -> str:
    if value in START_ALIASES:
        return "START"
    if value in END_ALIASES:
        return "END"
    return value


def test_compiled_topology_conforms_to_canonical_graph():
    spec = load_graph_spec()
    compiled = build_graph()
    topology = compiled_topology(compiled)
    nodes = {norm(node) for node in topology["nodes"]}
    edges = {(norm(source), norm(target)) for source, target in topology["edges"]}

    for node_id in spec.node_ids:
        assert node_id in nodes

    expected_edges = {(edge["from"], edge["to"]) for edge in spec.edges}
    for conditional in spec.conditional_edges:
        expected_edges.update((conditional["from"], target) for target in conditional["branches"].values())
    for node in spec.nodes:
        if node.get("kind") == "fanout":
            expected_edges.add((node["id"], node["into"]))

    missing = expected_edges - edges
    assert not missing
    assert ("START", "validate_scope") in edges
    assert ("evaluate", "plan_specialists") in edges
    assert ("reflexion_debrief", "END") in edges
