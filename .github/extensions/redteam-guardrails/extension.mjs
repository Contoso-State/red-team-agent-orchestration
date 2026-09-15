// Extension: redteam-guardrails
// Copilot App session adapter for Azure red team engagements.
//
// Copilot App (observed on 1.0.84-5) fails project `onPreToolUse` hooks BEFORE the callback
// is invoked — a minimal synchronous allow callback fails the same way. Because a security
// hook must fail closed, that rejection denied every tool call in the session, including
// commands with nothing to do with Azure (`git status`, `git fetch`). Registering the hook
// here therefore does not enforce the posture; it only makes the session unusable.
//
// Until the App honours project hooks, this adapter supplies the read-only posture at
// session start and leaves classification available through the platform-neutral CLI:
//
//   echo '{"command":"az vm delete ...","cwd":".","toolName":"shell"}' | node guardrails/guard.mjs
//
// IMPORTANT: Copilot App consequently has NO automatic tool-boundary enforcement. Claude,
// Codex and Cursor keep their native enforcement adapters over the same shared guard, and
// the repository-level guard remains the source of truth for every runtime that can run it.

import { joinSession } from "@github/copilot-sdk/extension";
import { READONLY_BANNER } from "../../../guardrails/guard.mjs";

const COMPATIBILITY_NOTICE =
  "Copilot App compatibility mode: the project onPreToolUse hook is not registered because " +
  "Copilot App rejects project tool hooks before the callback runs, which blocked every " +
  "command in the session. This runtime therefore has NO automatic tool-boundary " +
  "enforcement. Preserve the read-only posture manually: classify any Azure command before " +
  "running it by piping its JSON payload to `node guardrails/guard.mjs`, and never run a " +
  "mutating az/azd/Az PowerShell command against the engagement subscription.";

await joinSession({
  hooks: {
    onSessionStart: async () => ({
      additionalContext: `${READONLY_BANNER}\n\n${COMPATIBILITY_NOTICE}`,
    }),
  },
});
