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
// Decision logic lives in the platform-neutral shared core at guardrails/core/ (pure +
// unit-tested). This extension is only the Copilot-SDK wire adapter; Claude, Codex and
// Cursor have their own thin adapters over the same core.

import { joinSession } from "@github/copilot-sdk/extension";
import { decideSafe, READONLY_BANNER } from "../../../guardrails/guard.mjs";

const session = await joinSession({
  hooks: {
    onSessionStart: async () => ({
      additionalContext: READONLY_BANNER,
    }),

    onPreToolUse: async (input) => {
      // Keep hook execution pure: nested session RPCs from inside a permission hook can
      // deadlock or fail on some hosts. The shared adapter handles all three evaluators,
      // catches malformed input, and fails closed.
      const result = decideSafe({
        command: input?.toolArgs,
        cwd: input?.workingDirectory,
        toolName: input?.toolName,
      });
      return {
        permissionDecision: result.decision,
        ...(result.reason ? { permissionDecisionReason: result.reason } : {}),
      };
    },
  },
});
