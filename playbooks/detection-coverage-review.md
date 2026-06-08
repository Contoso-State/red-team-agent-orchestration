# Playbook: Detection Coverage Review

**Goal:** Determine whether the attacks simulated in the other playbooks would actually be detected. Identify monitoring blind spots.

**Owner:** Logging & Coverage Agent.

**Mode required:** `read-only-assessment`.

## Why this matters

A red team assessment is incomplete if it only finds vulnerabilities. The defender's real question is: "If this were exploited, would we see it?" This playbook answers that by mapping detection coverage against the discovered attack surface. This is **defensive coverage assessment** — identifying blind spots, never evasion guidance.

## Steps

### 1. Establish the monitoring baseline
Run: `CHK-LOG-DEFENDER-DISABLED`, `CHK-LOG-NO-SENTINEL-IDENTITY`, `CHK-LOG-NO-ACTIVITY-EXPORT`.

Determine: Is Defender for Cloud on? Is there a SIEM? Are Entra and Activity logs ingested?

### 2. Build a coverage matrix
For each significant resource type in the inventory, record:
- Diagnostic settings present? (`CHK-LOG-NO-DIAG-CRITICAL`, `CHK-LOG-NO-DIAG-KEYVAULT`)
- Logs forwarded to a central workspace?
- Network visibility? (`CHK-LOG-NO-NSG-FLOW`)

### 3. Map detection against discovered attacks
This is the key correlation step. For each High/Critical finding from other agents, ask: would the exploitation generate a detectable signal?

| Attack (from other playbooks) | Detection needed | Check |
|---|---|---|
| Privilege escalation (role grant) | Alert on roleAssignments/write | `CHK-LOG-NO-ALERT-ROLE-ASSIGN` |
| Key Vault secret theft | Key Vault audit logging | `CHK-LOG-NO-DIAG-KEYVAULT` |
| Identity attack (spray/token theft) | Entra logs in SIEM | `CHK-LOG-NO-SENTINEL-IDENTITY` |
| Data exfiltration | Storage/Defender alerts | `CHK-LOG-DEFENDER-DISABLED` |

### 4. Identify compounding findings
A vulnerability with **no detection coverage** is worse than one that's monitored. Flag these as compounding: "Exposed + Invisible." These should rank highest in remediation priority.

### 5. Check log integrity
Note whether logs could be tampered with or disabled by non-admins, and whether retention supports forensics.

## Output

A detection coverage report: the monitoring baseline, a coverage matrix by resource type, and — most importantly — a list of "exposed and undetectable" findings where exploitation would leave no trail.

## MITRE Mapping

Defensive context for T1562 (Impair Defenses), T1562.008 (Disable Cloud Logs). The output supports detection engineering, not evasion.
