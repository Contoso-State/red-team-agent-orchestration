"""Compile the canonical red-team graph spec into a LangGraph StateGraph."""

from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any, Callable

from .graph_spec import GraphSpec, REPO_ROOT, load_graph_spec
from .guard import decide
from .memory import MethodologyMemory
from .state import build_state_schema, merge_findings

INTEGRATION_ROOT = Path(__file__).resolve().parents[1]


def _load_langgraph() -> tuple[Any, Any, Any, Any, Any]:
    from langgraph.constants import END, START, Send
    from langgraph.graph import StateGraph
    try:
        from langgraph.types import interrupt
    except Exception:  # pragma: no cover - old langgraph fallback
        def interrupt(value: Any) -> Any:
            return value
    return StateGraph, START, END, Send, interrupt


def _make_checkpointer() -> Any:
    """Prefer SQLite checkpoints when the optional package is installed."""

    try:
        from langgraph.checkpoint.sqlite import SqliteSaver

        checkpoint_dir = INTEGRATION_ROOT / ".langgraph"
        checkpoint_dir.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(checkpoint_dir / "checkpoints.sqlite"), check_same_thread=False)
        saver = SqliteSaver(conn)
        setup = getattr(saver, "setup", None)
        if callable(setup):
            setup()
        return saver
    except Exception:
        from langgraph.checkpoint.memory import MemorySaver

        return MemorySaver()


def _make_store() -> Any:
    try:
        from langgraph.store.memory import InMemoryStore

        return InMemoryStore()
    except Exception:
        return None


def _scope_mode(state: dict[str, Any]) -> str:
    scope = state.get("scope") or {}
    return str(scope.get("mode") or "read-only-assessment")


def _roster_in_scope(roster: list[dict[str, Any]], state: dict[str, Any]) -> list[dict[str, Any]]:
    scope = state.get("scope") or {}
    filtered: list[dict[str, Any]] = []
    for item in roster:
        predicate = item.get("when")
        if predicate == "m365_in_scope" and not scope.get("m365_in_scope"):
            continue
        filtered.append(dict(item))
    return filtered


def _dispatch_stub(node: dict[str, Any]) -> Callable[[dict[str, Any]], dict[str, Any]]:
    """Create a dispatch node stub.

    TODO: replace this callable with the concrete adapter that invokes the named
    agent card in the selected runtime. Any Azure command emitted by that adapter
    must pass through redteam_langgraph.guard.guarded_run/decide first.
    """

    def dispatch(state: dict[str, Any]) -> dict[str, Any]:
        agent = node.get("agent")
        roster_item = state.get("_roster_item") or {}
        if agent == "$roster.agent":
            agent = roster_item.get("agent", agent)
        lane = str(node.get("lane") or roster_item.get("lane") or "default")

        if lane != "default":
            # Guard bridge smoke-check for the future active-lane adapter. This is
            # deliberately read-only and does not execute Azure commands.
            decision = decide("az account show", cwd=REPO_ROOT)
            if decision["decision"] != "allow":
                return {node.get("writes", "raw_findings"): []}

        writes = str(node.get("writes") or "")
        if writes == "inventory_ref":
            return {"inventory_ref": "engagements/<session>/inventory/resources.jsonl"}
        if writes == "raw_findings":
            domain = roster_item.get("domain") or lane
            return {
                "raw_findings": [
                    {
                        "dedupe_key": f"stub:{domain}:{agent}",
                        "agent": agent,
                        "domain": domain,
                        "lane": lane,
                        "affected_resources": [],
                        "status": "stub",
                    }
                ]
            }
        if writes == "attack_paths":
            return {"attack_paths": [{"source": "correlate", "status": "stub"}]}
        if writes == "report_refs":
            return {"report_refs": ["engagements/<session>/reports/stub-report.md"]}
        return {}

    dispatch.__name__ = f"dispatch_{node['id']}"
    return dispatch


def _node_callable(node: dict[str, Any], spec: GraphSpec, memory: MethodologyMemory, interrupt: Callable[[Any], Any]) -> Callable[[dict[str, Any]], dict[str, Any]]:
    kind = node.get("kind")

    if kind == "validate":
        def validate_scope(state: dict[str, Any]) -> dict[str, Any]:
            scope = dict(state.get("scope") or {})
            scope.setdefault("mode", "read-only-assessment")
            scope.setdefault("validated", True)
            scope.setdefault("read_only_role_attested", True)
            return {"scope": scope}
        return validate_scope

    if kind == "memory_read":
        return lambda state: {"memory": memory.read(str(node.get("namespace") or "methodology"))}

    if kind == "dispatch":
        return _dispatch_stub(node)

    if kind == "fanout":
        return lambda state: {}

    if kind == "reduce":
        def collect(state: dict[str, Any]) -> dict[str, Any]:
            return {str(node.get("writes")): merge_findings([], state.get(str(node.get("reads"))) or [])}
        return collect

    if kind == "evaluator":
        def evaluate(state: dict[str, Any]) -> dict[str, Any]:
            revision = int(state.get("revision") or 0) + 1
            candidates = state.get("candidate_findings") or []
            quality = 0.9 if candidates else 1.0
            return {"critique": {"quality": quality, "candidate_count": len(candidates)}, "revision": revision}
        return evaluate

    if kind == "judge":
        def judge(state: dict[str, Any]) -> dict[str, Any]:
            confirmed = list(state.get("candidate_findings") or [])
            memory.write(
                {"source": "judge", "confirmed_count": len(confirmed), "kind": "false_positive_gate"},
                namespace=node.get("memory_write", {}).get("namespace", "methodology"),
            )
            return {"confirmed_findings": confirmed}
        return judge

    if kind == "interrupt":
        def authorize(state: dict[str, Any]) -> dict[str, Any]:
            mode = _scope_mode(state)
            if mode not in {"external-active-testing", "cluster-active-testing"}:
                return {"approved": False}
            if state.get("approved") is not None:
                return {"approved": state.get("approved")}
            answer = interrupt({"prompt": node.get("prompt"), "mode": mode})
            approved = bool(answer.get("approved") if isinstance(answer, dict) else answer)
            return {"approved": approved}
        return authorize

    if kind == "memory_write":
        def reflexion_debrief(state: dict[str, Any]) -> dict[str, Any]:
            memory.write(
                {
                    "source": node.get("id"),
                    "kind": "reflexion_debrief",
                    "confirmed_count": len(state.get("confirmed_findings") or []),
                },
                namespace=str(node.get("namespace") or "methodology"),
            )
            return {}
        return reflexion_debrief

    return lambda state: {}


def build_graph(graph_path: str | Path | None = None) -> Any:
    """Build and compile the LangGraph graph for the canonical spec."""

    StateGraph, START, END, Send, interrupt = _load_langgraph()
    spec = load_graph_spec(graph_path)
    memory = MethodologyMemory()
    state_schema = build_state_schema(spec)
    workflow = StateGraph(state_schema)

    for node in spec.nodes:
        workflow.add_node(str(node["id"]), _node_callable(dict(node), spec, memory, interrupt))

    node_by_id = spec.node_by_id
    for edge in spec.edges:
        source = START if edge["from"] == "START" else str(edge["from"])
        target = END if edge["to"] == "END" else str(edge["to"])
        workflow.add_edge(source, target)

    def fanout_roster(state: dict[str, Any]) -> list[Any]:
        roster = _roster_in_scope([dict(item) for item in spec.roster], state)
        source = node_by_id["plan_specialists"]
        target = str(source.get("into", "run_specialist"))
        sends = []
        for item in roster:
            sends.append(
                Send(
                    target,
                    {
                        "scope": state.get("scope"),
                        "memory": state.get("memory"),
                        "inventory_ref": state.get("inventory_ref"),
                        "revision": state.get("revision"),
                        "_roster_item": item,
                    },
                )
            )
        return sends

    def route_after_evaluate(state: dict[str, Any]) -> str:
        critique = state.get("critique") or {}
        quality = float(critique.get("quality") or 0.0)
        revision = int(state.get("revision") or 0)
        if revision < int(spec.params.get("max_revisions", 0)) and quality < float(spec.params.get("quality_threshold", 1.0)):
            return "refine"
        return "proceed"

    def route_active(state: dict[str, Any]) -> str:
        if not state.get("approved"):
            return "none"
        mode = _scope_mode(state)
        if mode == "external-active-testing":
            return "external_active"
        if mode == "cluster-active-testing":
            return "cluster_active"
        return "none"

    routers = {"route_after_evaluate": route_after_evaluate, "route_active": route_active}

    for node in spec.nodes:
        if node.get("kind") == "fanout":
            workflow.add_conditional_edges(str(node["id"]), fanout_roster, [str(node.get("into", "run_specialist"))])

    for conditional in spec.conditional_edges:
        workflow.add_conditional_edges(
            str(conditional["from"]),
            routers[str(conditional["router"])],
            {label: (END if target == "END" else target) for label, target in conditional["branches"].items()},
        )

    store = _make_store()
    checkpointer = _make_checkpointer()
    compile_kwargs: dict[str, Any] = {"checkpointer": checkpointer}
    if store is not None:
        compile_kwargs["store"] = store
    try:
        return workflow.compile(**compile_kwargs)
    except TypeError:
        compile_kwargs.pop("store", None)
        return workflow.compile(**compile_kwargs)


def compiled_topology(compiled: Any) -> dict[str, Any]:
    """Return a normalized topology dictionary for dry-runs and tests."""

    graph_obj = compiled.get_graph()
    nodes = sorted(str(name) for name in getattr(graph_obj, "nodes", {}).keys())
    edges: list[tuple[str, str]] = []
    for edge in getattr(graph_obj, "edges", []):
        source = getattr(edge, "source", None)
        target = getattr(edge, "target", None)
        if source is None and isinstance(edge, (tuple, list)) and len(edge) >= 2:
            source, target = edge[0], edge[1]
        edges.append((str(source), str(target)))
    return {"nodes": nodes, "edges": sorted(edges)}


try:
    graph = build_graph()
except Exception:  # pragma: no cover - lets import-light modules work without deps
    graph = None
