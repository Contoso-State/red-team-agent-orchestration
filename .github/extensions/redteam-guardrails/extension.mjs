// Extension: redteam-guardrails
// Read-only enforcement for Azure red team engagements.
//
// Registers a preToolUse hook that enforces a READ-ONLY posture across every agent in the
// session (including sub-agents the orchestrator dispatches). Any Azure CLI (az/azd) or Azure
// PowerShell command that is not a recognized read/query operation is DENIED. In
// controlled-validation mode the same commands are downgraded to an explicit human-approval
// prompt instead of being allowed silently — the read-only guarantee can never be bypassed
// without intent.
//
// Decision logic lives in guardrails-core.mjs (pure + unit-tested in guardrails-core.test.mjs).

import { joinSession } from "@github/copilot-sdk/extension";
import { evaluate, engagementMode } from "./guardrails-core.mjs";

const session = await joinSession({
  hooks: {
    onSessionStart: async () => ({
      additionalContext:
        "redteam-guardrails active: this is an Azure red team engagement with a READ-ONLY posture. " +
        "Only read/query Azure commands are permitted (az list/show/get/query, Get-Az*, " +
        "az rest --method GET). Mutating az/azd/Az PowerShell commands are blocked unless " +
        "engagement.yaml sets mode: controlled-validation, in which case they require explicit " +
        "human approval. The orchestrator must dispatch specialist agents — it does not run az itself.",
    }),

    onPreToolUse: async (input) => {
      const decision = evaluate(input.toolArgs, input.workingDirectory, input.toolName);
      if (!decision.deny && !decision.ask) return undefined;

      const mode = engagementMode(input.workingDirectory);

      if (decision.ask) {
        await session.log(
          `Mutating Azure command requires approval (mode: ${mode}): ${decision.segment}`,
          { level: "warning" }
        );
        return {
          permissionDecision: "ask",
          permissionDecisionReason:
            `controlled-validation mode: this is a state-changing Azure operation ` +
            `(${decision.reason}). Approve only if explicitly authorized in the engagement scope. ` +
            `Command: \`${decision.segment}\``,
        };
      }

      await session.log(
        `Blocked non-read-only Azure command (mode: ${mode}): ${decision.segment}`,
        { level: "warning" }
      );
      return {
        permissionDecision: "deny",
        permissionDecisionReason:
          `Red team engagement is in '${mode}' mode (read-only). ${decision.reason}. ` +
          `Blocked: \`${decision.segment}\`. Use a read-only equivalent (list/show/get/query/Get-Az*), ` +
          `or set mode: controlled-validation in engagement.yaml if this action is explicitly authorized.`,
      };
    },
  },
});

await session.log("redteam-guardrails loaded — read-only Azure enforcement active");
