"""Runtime parity and evidence handoff regressions; all dispatch remains local stubs."""

import copy
import json
import subprocess

import pytest

pytest.importorskip("langgraph")

from langgraph.checkpoint.memory import MemorySaver

from redteam_langgraph import builder
from redteam_langgraph.graph_spec import GraphSpec, REPO_ROOT, load_graph_spec
from redteam_langgraph.memory import MethodologyMemory


SCOPE_CASES = [
    {},
    {"m365_in_scope": True},
    {"m365_in_scope": "false"},
    {"flags": ["m365_in_scope"], "domains": ["email-security"]},
    {"domains": ["data-protection"]},
    {"domains": ["data-protection"], "resource_types": ["Microsoft.Storage/storageAccounts"]},
    {"domains": ["data-protection"], "resource_types": ["Microsoft.Network/*"]},
    {"resource_types": ["Microsoft.Network/*"]},
    {"resource_types": ["mIcRoSoFt.NeTwOrK/aPpLiCaTiOnGaTeWaYs"]},
    {"resource_types": ["Microsoft.Network/privateEndpoints"]},
    {"resource_types": ["Microsoft.Unknown/*"]},
    {"m365_in_scope": True, "resource_types": ["Microsoft.Compute/virtualMachines"]},
]


def node_results(script, values):
    result = subprocess.run(
        ["node", "--input-type=module", "-e", script],
        cwd=REPO_ROOT,
        input=json.dumps(values),
        text=True,
        capture_output=True,
        check=True,
    )
    return json.loads(result.stdout)


def test_scoped_roster_matches_node_runner():
    spec = load_graph_spec()
    expected = node_results(
        """
        import { readFileSync } from 'node:fs';
        import { loadGraph, inScopeRoster } from './tools/graph/run-graph.mjs';
        const {graph} = loadGraph('graph/redteam.graph.json');
        console.log(JSON.stringify(JSON.parse(readFileSync(0, 'utf8')).map(scope =>
          inScopeRoster(graph, {scope}).map(item => item.domain))));
        """,
        SCOPE_CASES,
    )
    actual = [
        [item["domain"] for item in builder._roster_in_scope(list(spec.roster), {"scope": scope})]
        for scope in SCOPE_CASES
    ]
    assert actual == expected
    assert actual[5] == ["data"]
    assert actual[6] == []
    assert actual[7] == actual[8] == ["network", "web", "easm"]


def test_security_context_matches_node_and_never_verifies_a_reference():
    states = [
        {},
        {"scope": {"domains": ["data-protection"]}, "inventory_ref": "/nonexistent/inventory.jsonl"},
        *({"inventory_ref": value} for value in [None, "", "  ", {}, [], True, 123]),
    ]
    expected = node_results(
        """
        import { readFileSync } from 'node:fs';
        import { buildSecurityContext } from './tools/graph/run-graph.mjs';
        console.log(JSON.stringify(JSON.parse(readFileSync(0, 'utf8')).map(buildSecurityContext)));
        """,
        states,
    )
    actual = [builder.build_security_context(state) for state in states]
    assert actual == expected
    assert len(actual[0]["signals"]) == 8
    assert actual[1]["inventory"]["status"] == "referenced"
    assert actual[1]["signals"]["arm"]["status"] == "unverified"
    assert all(context["inventory"]["status"] == "missing" for context in actual[2:])


@pytest.fixture
def compiled_graph(monkeypatch, tmp_path):
    # Assessment simulations must not write to the user's methodology store.
    monkeypatch.setattr(builder, "MethodologyMemory", lambda: MethodologyMemory(tmp_path / "memory"))
    monkeypatch.setattr(builder, "_make_checkpointer", MemorySaver)
    seen = []
    original_dispatch = builder._dispatch_stub

    def dispatch_factory(node):
        dispatch = original_dispatch(node)
        if node["id"] != "run_specialist":
            return dispatch

        def specialist(state):
            seen.append(copy.deepcopy(state))
            return dispatch(state)

        return specialist

    monkeypatch.setattr(builder, "_dispatch_stub", dispatch_factory)
    return builder.build_graph(), seen


def test_real_langgraph_send_delivers_context_and_preserves_deterministic_results(compiled_graph):
    compiled, seen = compiled_graph
    scope = {"domains": ["data-protection"], "resource_types": ["Microsoft.Storage/storageAccounts"]}
    first = compiled.invoke({"scope": scope}, {"configurable": {"thread_id": "scope-first"}})
    second = compiled.invoke({"scope": scope}, {"configurable": {"thread_id": "scope-second"}})
    assert [entry["_roster_item"]["domain"] for entry in seen] == ["data", "data"]
    assert all(entry["security_context"] == first["security_context"] for entry in seen)
    assert seen[0]["security_context"]["signals"]["arm"]["status"] == "unverified"
    assert first["candidate_findings"] == second["candidate_findings"]
    assert first["confirmed_findings"] == second["confirmed_findings"]
    assert first["report_refs"] and second["report_refs"]


def test_empty_scoped_roster_still_reaches_report(compiled_graph):
    compiled, seen = compiled_graph
    result = compiled.invoke(
        {"scope": {"domains": ["data-protection"], "resource_types": ["Microsoft.Network/*"]}},
        {"configurable": {"thread_id": "scope-empty"}},
    )
    assert not seen
    assert result["candidate_findings"] == []
    assert result["report_refs"]


@pytest.mark.parametrize("mode,prefix", [
    ("external-active-testing", "external_testing"),
    ("cluster-active-testing", "cluster_testing"),
])
def test_active_requirements_checked_before_interrupt_or_preapproved_resume(mode, prefix, tmp_path):
    spec = load_graph_spec()
    interrupts = []
    authorize = builder._node_callable(
        dict(spec.node_by_id["authorize_active"]), spec, MethodologyMemory(tmp_path),
        lambda value: interrupts.append(value) or {"approved": True},
    )
    invalid = [
        {},
        {"enabled": "false", "authorization": {"attestation_id": "ROE-1"}},
        {"enabled": 1, "authorization": {"attestation_id": "ROE-1"}},
        {"enabled": False, "authorization": {"attestation_id": "ROE-1"}},
        *({"enabled": True, "authorization": {"attestation_id": value}}
          for value in [None, "", "  ", {}, [], True, 1]),
    ]
    for block in invalid:
        for approved in [None, True]:
            with pytest.raises(ValueError, match="requires"):
                authorize({"scope": {"mode": mode, prefix: block}, "approved": approved})
    assert not interrupts
    valid = {"mode": mode, prefix: {"enabled": True, "authorization": {"attestation_id": "ROE-1"}}}
    assert authorize({"scope": valid}) == {"approved": True}
    assert len(interrupts) == 1
    for approved in ["true", "false", 1, {}, []]:
        assert authorize({"scope": valid, "approved": approved}) == {"approved": False}
    assert len(interrupts) == 1


@pytest.mark.parametrize("answer", ["true", "false", 1, {"approved": "true"}, {"approved": 1}])
def test_active_interrupt_requires_a_boolean_approval(answer, tmp_path):
    spec = load_graph_spec()
    authorize = builder._node_callable(
        dict(spec.node_by_id["authorize_active"]), spec, MethodologyMemory(tmp_path), lambda value: answer,
    )
    assert authorize({"scope": {
        "mode": "external-active-testing",
        "external_testing": {"enabled": True, "authorization": {"attestation_id": "ROE-1"}},
    }}) == {"approved": False}


@pytest.mark.parametrize("requirements", [[], ["external_testing.enabled"], [
    "external_testing.enabled", "external_testing.authorization.attestation_id", "unsupported.requirement",
]])
def test_active_gate_contract_fails_closed(requirements, tmp_path):
    original = load_graph_spec()
    data = copy.deepcopy(original.data)
    for node in data["nodes"]:
        if node.get("gated", {}).get("mode") == "external-active-testing":
            node["gated"]["requires"] = requirements
    spec = GraphSpec(path=original.path, data=data)
    authorize = builder._node_callable(
        dict(spec.node_by_id["authorize_active"]), spec, MethodologyMemory(tmp_path), lambda value: True,
    )
    with pytest.raises(ValueError, match="requires"):
        authorize({"scope": {
            "mode": "external-active-testing",
            "external_testing": {"enabled": True, "authorization": {"attestation_id": "ROE-1"}},
        }})
