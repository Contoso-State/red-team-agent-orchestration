"""Target-owned AEF memory graph. Uses the pinned installed wheel, never upstream imports."""
from __future__ import annotations

import dataclasses
import hashlib
from importlib.resources import files
import json
from pathlib import Path
import re
import sys
import uuid
from datetime import datetime, timezone

from aef.kernel import END, Edge, Graph, GraphExecutor, Node
from aef.kernel.durability import FileDurabilityBackend
from aef.reasoning.nodes import make_reflect_node
from aef.services.context.memory_retriever import MemoryRetriever
from aef.services.knowledge.consolidate import RuleBasedConsolidator
from aef.services.knowledge.in_memory import InMemoryKnowledgeStore
from aef.services.memory.base import MemoryRecord
from aef.services.memory.in_memory import InMemoryMemoryStore
from aef.services.runtime import agent_services
from aef.state import AEFState, StateDelta

ROOT = Path(__file__).resolve().parent
TOKEN = re.compile(r"[a-zA-Z0-9_:-][a-zA-Z0-9_.:-]{0,179}\Z")
HASH = re.compile(r"[a-f0-9]{64}\Z")
BUDGET = 2000


def contained(path, parent):
    result = Path(path).resolve()
    if parent.resolve() not in result.parents:
        raise ValueError("Path outside target engagement")
    return result


def token(value):
    if not isinstance(value, str) or not TOKEN.fullmatch(value):
        raise ValueError("Invalid attribution")
    return value


def run_request(request, emit=lambda event: None):
    source_commit = json.loads((ROOT / "tools/aef/source-lock.json").read_text())["commit"]
    installed = json.loads(files("aef").joinpath("_redteam_build.json").read_text())
    if not re.fullmatch(r"[a-f0-9]{40}", source_commit) or installed.get("sourceCommit") != source_commit:
        raise ValueError("Installed AEF revision does not match the source lock; rebuild the target runtime")
    engagements = (ROOT / "engagements").resolve()
    session = contained(ROOT / request["session"], engagements)
    if session.parent != engagements or not session.is_dir():
        raise ValueError("A direct target engagement is required")
    run_id = token(request["runId"])
    environment_key = request["environmentKey"]
    if not HASH.fullmatch(environment_key):
        raise ValueError("Invalid environment identity")
    output = contained(session / "memory/methodology/aef", session)
    output.mkdir(parents=True, exist_ok=True)
    results = {}
    for agent, supplied in request["agents"].items():
        token(agent)
        records = supplied["records"]
        if len(records) > 10000:
            raise ValueError("Too many records")
        memory, knowledge = InMemoryMemoryStore(), InMemoryKnowledgeStore()
        for record in records:
            source_run = token(record["runId"])
            if record["agent"] != agent or source_run == run_id:
                raise ValueError("Memory attribution mismatch")
            base = contained(ROOT / record["sourceSession"], engagements)
            if base.parent != engagements:
                raise ValueError("Invalid source session")
            history_path = contained(base / "memory/methodology" / (source_run + ".json"), base)
            history = json.loads(history_path.read_text())
            fields = {key: record[key] for key in ("agent", "checkId", "signature", "outcome", "evidence")}
            if history.get("version") != 1 or history["environmentKey"] != environment_key or history["runId"] != source_run or fields not in history["records"]:
                raise ValueError("Unverified memory source")
            token(record["checkId"])
            if not HASH.fullmatch(record["signature"]) or record["outcome"] not in ("confirmed", "suppressed", "coverage-gap") or not record["evidence"]:
                raise ValueError("Invalid observation")
            for evidence in record["evidence"]:
                path = contained(base / evidence["path"], base)
                if hashlib.sha256(path.read_bytes()).hexdigest() != evidence["sha256"]:
                    raise ValueError("Evidence integrity failed")
            content = {key: record[key] for key in ("checkId", "signature", "outcome")}
            content["feedback"] = f"Verified observation {record['checkId']} {record['outcome']}; revalidate current evidence."
            identity = hashlib.sha256(json.dumps([agent, source_run, content], sort_keys=True).encode()).hexdigest()
            memory.write(MemoryRecord(id=identity, kind="success", content=content, run_id=source_run, agent_id=agent, tags=("verified-evidence",), created_at=datetime.fromtimestamp(history_path.stat().st_mtime, timezone.utc)))
        retriever = MemoryRetriever(memory, agent_id=agent, knowledge=knowledge, candidates_per_kind=max(1, len(records)), max_token_budget=BUDGET)
        consolidator = RuleBasedConsolidator(signature_fn=lambda r: ":".join(str(r.content[k]) for k in ("checkId", "signature", "outcome")), min_occurrences=2, candidates_per_kind=max(1, len(records)))
        def event(node, phase, metrics=None):
            emit({"type": "node." + phase, "node_id": node, "agent_id": agent, "metrics": metrics or {}})
        def consolidate(state, ctx, services):
            event("aef_consolidate", "started")
            entries = consolidator.consolidate(memory, knowledge, agent_id=agent)
            event("aef_consolidate", "completed", {"knowledge_count": len(entries)})
            return StateDelta(), "aef_retrieve"
        def retrieve(state, ctx, services):
            event("aef_retrieve", "started")
            query = agent + " " + " ".join(sorted({r["checkId"] for r in records}))
            chunks = retriever.retrieve(query, token_budget=BUDGET)
            used = sum(c.token_estimate for c in chunks)
            event("aef_retrieve", "completed", {"retrieved": len(chunks), "context_tokens": used, "context_budget": BUDGET, "records": len(records)})
            return StateDelta(retrieved_context=[dataclasses.asdict(c) for c in chunks], scores={"context_budget_compliance": float(used <= BUDGET)}), "aef_reflect"
        reflect_impl = make_reflect_node(node_id="aef_reflect", memory_tags=("local-retrieval-contract",))
        def reflect(state, ctx, services):
            event("aef_reflect", "started")
            result = reflect_impl.fn(state, ctx, services)
            event("aef_reflect", "completed", {"count": 1})
            return result
        nodes = {name: Node(id=name, version="1.0.0", fn=fn, deterministic=False) for name, fn in (("aef_consolidate", consolidate), ("aef_retrieve", retrieve), ("aef_reflect", reflect))}
        graph = Graph(id="redteam-methodology", version="1.0.0", nodes=nodes, edges=[Edge("aef_consolidate", "aef_retrieve"), Edge("aef_retrieve", "aef_reflect")], entry_node="aef_consolidate")
        execution = str(uuid.uuid4())
        services = agent_services(memory=memory, knowledge=knowledge, retriever=retriever, agent_id=agent, durability=FileDurabilityBackend(output / "checkpoints"))
        state = GraphExecutor(graph.compile(), services).run(AEFState(run_id=execution, agent_id=agent, objective="Verify and retrieve evidence-backed methodology within the context budget", context_budget_tokens=BUDGET)).final_state
        sources = [{key: record[key] for key in ("sourceSession", "runId", "checkId", "signature", "outcome", "evidence")} for record in records]
        results[agent] = {"context": state.retrieved_context, "knowledge": [dataclasses.asdict(x) for x in knowledge.query("success", agent_id=agent, limit=10000)], "checkpointRun": execution, "reflections": state.reflections, "sourceRecords": len(records), "sources": sources, "improvementVerified": False}
    report = {"engine": "aef-core", "sourceCommit": source_commit, "graph": "redteam-methodology/1.0.0", "modelCalls": 0, "environmentKey": environment_key, "agents": results}
    report_path = output / (str(uuid.uuid4()) + ".json")
    report["reportRef"] = report_path.relative_to(session).as_posix()
    report_path.write_text(json.dumps(report, default=str, indent=2) + "\n")
    return report


if __name__ == "__main__":
    try:
        raw = sys.stdin.buffer.read(2_000_001)
        if len(raw) > 2_000_000:
            raise ValueError("Request too large")
        result = run_request(json.loads(raw), lambda event: print(json.dumps({"kind": "event", "event": event}), flush=True))
        print(json.dumps({"kind": "result", "result": result}, default=str), flush=True)
    except Exception as error:
        print(type(error).__name__, file=sys.stderr)
        sys.exit(1)
