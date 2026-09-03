#!/usr/bin/env node

import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT, loadGraph } from "./run-graph.mjs";
import { makeAuditLog, makeProceduralStore, runSelfImprovingGraph } from "./self-improve.mjs";

export function verifyLearningLoop() {
  const { graph, error } = loadGraph(join(ROOT, "graph", "redteam.graph.json"));
  assert.equal(error, null, error);

  const store = makeProceduralStore();
  const audit = makeAuditLog();
  const dispatchFn = (node, context) => {
    if (node.writes !== "raw_findings" || !context.item) return {};
    const domain = context.item.domain;
    return {
      writes: {
        raw_findings: [{
          dedupe_key: `verification:${domain}`,
          domain,
          agent_id: domain,
          severity: "medium",
          affected_resources: [{ resource_id: `/verification/${domain}` }],
        }],
      },
    };
  };
  const options = {
    store,
    audit,
    scope: { mode: "read-only-assessment", m365_in_scope: false },
    dispatchFn,
  };

  const first = runSelfImprovingGraph(graph, { ...options, runId: "verification-run-a" });
  const firstEntries = store.load("methodology").entries;
  assert.equal(first.status, "completed");
  assert.equal(firstEntries.some((entry) => entry.kind === "knowledge"), false);
  assert.equal(firstEntries.some((entry) => entry.kind === "param_tuning"), false);

  const second = runSelfImprovingGraph(graph, { ...options, runId: "verification-run-b" });
  const entries = store.load("methodology").entries;
  const knowledge = entries.filter((entry) => entry.kind === "knowledge");
  const tunings = entries.filter((entry) => entry.kind === "param_tuning");
  assert.equal(second.status, "completed");
  assert.equal(knowledge.length, first.state.confirmed_findings.length);
  assert.equal(tunings.length, 1);
  assert.ok(knowledge.every((entry) => JSON.stringify(entry.run_ids) === JSON.stringify(["verification-run-a", "verification-run-b"])));
  assert.equal(audit.verify(), true);
  assert.throws(() => store.write("guardrails", { kind: "forbidden" }), /FIREWALL/);

  return {
    graph: `${graph.name}@${graph.version}`,
    graph_nodes: graph.nodes.length,
    roster_lanes_exercised: first.state.confirmed_findings.length,
    runs: 2,
    first_run_promotions: 0,
    second_run_knowledge_promotions: knowledge.length,
    second_run_parameter_promotions: tunings.length,
    audit_events: audit.count(),
    audit_chain_valid: true,
    memory_firewall_valid: true,
    status: "passed",
  };
}

function main() {
  const result = verifyLearningLoop();
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`✓ graph + self-learning loop passed — ${result.graph_nodes} nodes, ${result.roster_lanes_exercised} roster lanes, ${result.second_run_knowledge_promotions} evidence-gated lessons promoted on run 2`);
  console.log("  first run stayed provisional; audit chain and memory firewall passed");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
