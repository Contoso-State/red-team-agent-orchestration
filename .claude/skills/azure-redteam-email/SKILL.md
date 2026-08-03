---
name: azure-redteam-email
description: Use this OPTIONAL skill to assess Microsoft 365 email security during a red team engagement when Exchange Online / M365 is in scope. Covers email authentication (SPF, DKIM, DMARC) via DNS, Exchange Online Protection and Microsoft Defender for Office 365 policies (anti-phishing, anti-spoofing, Safe Links, Safe Attachments), and risky mail-flow / transport rules. Trigger when assessing email spoofing risk, SPF/DKIM/DMARC posture, phishing defenses, or Exchange Online mail security. Requires Microsoft Graph / Exchange Online read permissions.
---

# Azure Red Team — Email Security (Optional, Microsoft 365)

You assess whether the organization's email can be spoofed and whether inbound phishing is stopped.
This is the **Microsoft 365 / Exchange Online** surface — adjacent to Azure but distinct — covering
domain authentication and the EOP / Defender for Office 365 policy stack.

> **Scope note:** Only run when `engagement.yaml` includes M365 / Exchange Online and the caller has
> Microsoft Graph / Exchange Online read access. This is not part of a baseline Azure assessment.

Full methodology: `agents/email-security/system-prompt.md`. Checks: `checks/email/checks.yaml`.
**Runner: `tools/az-cli/email.md`** — DNS lookups + Microsoft Graph (`az rest` GET) / Exchange Online
`Get-*` cmdlets.

## What You Hunt

- **SPF:** missing record, `+all`/`?all` (permissive), or no SPF at all — enables sender spoofing.
- **DMARC:** missing record, policy `p=none` (monitor-only), or no aggregate reporting — spoofed mail
  is not rejected/quarantined.
- **DKIM:** signing not enabled for accepted domains; weak (1024-bit) keys.
- **Anti-phishing (Defender for Office 365):** no anti-phishing policy, spoof intelligence off,
  mailbox/impersonation protection disabled.
- **Safe Links / Safe Attachments:** disabled or not applied to all users.
- **Connection filtering / EOP:** permissive allow-lists, IP allow-lists bypassing spam filtering.
- **Mail-flow / transport rules:** rules that bypass spam filtering, auto-forward externally, or
  whitelist senders/domains broadly (data-exfil and phishing-bypass risk).

## How You Work

1. Enumerate accepted domains (Graph `GET /domains`).
2. For each domain, resolve SPF (`TXT`), DMARC (`_dmarc.<domain>` TXT), and DKIM selector records via DNS.
3. Read EOP / Defender for Office 365 policy posture via Microsoft Graph security/policy endpoints
   (or Exchange Online PowerShell `Get-AntiPhishPolicy`, `Get-SafeLinksPolicy`, etc. where available).
4. Review transport rules for external auto-forward and filter-bypass.
5. Emit findings to `engagements/<session>/findings/raw/email-security.jsonl`, ID prefix `AZ-MAIL-`.

## Tools

DNS resolution (`nslookup` / `dig`), `az rest` (GET) against Microsoft Graph, and Exchange Online
PowerShell `Get-*` cmdlets (read-only) when the module is connected.

## Safety

Read-only. DNS and `Get-*`/GET reads only. Never send test/phishing email, never modify policies or
transport rules, never read message contents. Honor `data_handling` redaction for domains and addresses.
