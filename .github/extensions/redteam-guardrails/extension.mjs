// Extension: redteam-guardrails
// Read-only enforcement for Azure red team engagements.
//
// Registers a preToolUse hook that DENIES mutating Azure CLI commands (az / azd) so an
// engagement running in read-only mode can never accidentally change the target environment.
// The block is lifted only when engagement.yaml sets mode: controlled-validation.
//
// Decision logic lives in guardrails-core.mjs (pure + unit-tested in guardrails-core.test.mjs).

import { joinSession } from "@github/copilot-sdk/extension";
import { evaluate, engagementMode } from "./guardrails-core.mjs";

const session = await joinSession({
  hooks: {
    onSessionStart: async () => ({
      additionalContext:
        "redteam-guardrails active: this is an Azure red team engagement. Default posture is " +
        "READ-ONLY. Mutating az/azd commands are blocked unless engagement.yaml sets " +
        "mode: controlled-validation. Use list/show/get/query commands only.",
    }),

    onPreToolUse: async (input) => {
      const decision = evaluate(input.toolArgs, input.workingDirectory);
      if (!decision.deny) return undefined;

      const mode = engagementMode(input.workingDirectory);
      await session.log(
        `Blocked mutating Azure command (mode: ${mode}): ${decision.segment}`,
        { level: "warning" }
      );
      return {
        permissionDecision: "deny",
        permissionDecisionReason:
          `Red team engagement is in '${mode}' mode (read-only). ${decision.reason}. ` +
          `Blocked: \`${decision.segment}\`. Use a read-only equivalent (list/show/get/query), or ` +
          `set mode: controlled-validation in engagement.yaml if this action is explicitly authorized.`,
      };
    },
  },
});

await session.log("redteam-guardrails loaded — read-only Azure enforcement active");
