// Extension: redteam-guardrails
// Copilot App compatibility adapter for Azure red team engagements.
//
// Copilot App 1.0.84-5 errors before invoking project onPreToolUse callbacks, including
// minimal synchronous allow callbacks. Registering that hook therefore blocks every command
// before the shared guard can classify it. Until the App hook is compatible, this adapter
// supplies the read-only posture at session start and leaves command classification available
// through the platform-neutral guardrails/guard.mjs CLI.
//
// Claude, Codex, and Cursor retain their native enforcement adapters over the same shared guard.

import { joinSession } from "@github/copilot-sdk/extension";
import { READONLY_BANNER } from "../../../guardrails/guard.mjs";

const COMPATIBILITY_NOTICE =
  "Copilot App compatibility mode: project onPreToolUse registration is disabled because " +
  "Copilot App 1.0.84-5 rejects tool calls before the callback runs. Preserve the read-only " +
  "posture and classify any command before execution by piping its JSON payload to " +
  "`node guardrails/guard.mjs`.";

await joinSession({
  hooks: {
    onSessionStart: async () => ({
      additionalContext: `${READONLY_BANNER}\n\n${COMPATIBILITY_NOTICE}`,
    }),
  },
});
