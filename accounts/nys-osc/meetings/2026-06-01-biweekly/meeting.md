# Meeting Packet — 2026-06-01 — OSC Bi-Weekly

## Meeting Info
- **Date:** 2026-06-01
- **Account:** nys-osc
- **Type:** Bi-Weekly Cadence
- **Attendees:** TBD
- **Cadence:** Every 2 weeks

## Decision & Outcome
- **Single decision needed:** Align OSC on the ITS WinRM/SSH lockdown solution design and confirm OSC-specific requirements
- **Best-case outcome:** OSC endorses the ITS solution design (Arc + Bastion + ASG/NSG) and confirms they have no additional WinRM/SSH use cases beyond what ITS raised
- **Fallback outcome:** OSC identifies additional use cases that need to be folded into the solution design before the ITS + ISO meeting

---

## Agenda

1. **Status check — SSPR / WHfB rollout** (5 min)
   - Follow up on open items from 5/28 Kristen meeting
   - Desk phone / Teams Phone coverage confirmation
   - Hardware OATH pilot group identified?
   - M365 environment confirmed (commercial vs GCC)?

2. **WinRM / SSH lockdown — ITS shared solution design** (20 min)
   - ITS Windows Server + ESS teams raised 8 scenarios requiring WinRM/SSH
   - Microsoft proposed solution: **don't disable WinRM/SSH — lock down the network path**
   - Walk through architecture with OSC to confirm alignment

3. **Open questions / new topics** (5 min)

---

## Topic 2 Deep-Dive: WinRM/SSH Lockdown

### Background (for OSC)
ITS manages infrastructure for all NY state agencies including OSC. The Windows Server team and ESS team raised concerns about disabling WinRM and SSH on Azure VMs — they have legitimate operational dependencies. Rather than removing the protocols, Microsoft's recommendation is to **collapse the attack surface to a single hardened management path**.

### The ITS Scenarios (OSC should be aware)

**Windows (WinRM):**
- W1: Operational/security tooling depends on WinRM (tools not yet ARM/Arc-compatible)
- W2: ARM Run Command insufficient for real-time troubleshooting
- W3: Hybrid environments need consistent management (Azure + on-prem)
- W4: Azure-native tools aren't 1:1 replacements yet
- W5: Disabling WinRM today = operational risk

**Linux (SSH):**
- E1: Sudoers distribution via SCP from on-prem git server
- E2: PeopleSoft COBOL/SQR SFTP DR sync
- E3: RHEL build/config scripts run over SSH

### Proposed Solution Architecture

```
Admin → Entra ID (MFA + PIM) → Azure Bastion → AVD Ops Server → Target Servers
                                                    ↓
                                          WinRM HTTPS (5986) — ASG-restricted
                                          SSH (22) — ASG-restricted, Entra cert auth
```

**Core stack:**
| Component | Purpose |
|---|---|
| **AVD Session Host (Ops Mgmt Server)** | Single hardened jump point — replaces direct WinRM/SSH from workstations |
| **Azure Bastion Premium** | Secure tunnel to AVD; session recording; no public IPs |
| **ASG/NSG rules** | WinRM/SSH allowed ONLY from ASG-Ops-Mgmt → target ASGs |
| **Entra ID + PIM/JIT** | Time-bound admin elevation; MFA required |
| **gMSA accounts** | Service account auth for automation tools (no static passwords) |
| **Defender for Servers P2** | Monitoring, JIT VM access, vulnerability assessment |
| **Defender for Identity** | Detect credential theft and lateral movement |
| **Microsoft Sentinel** | Centralized logging, session recording, anomaly detection |
| **Azure Arc** (long-term) | Extend Azure management plane to on-prem servers |

**Key message for OSC:** WinRM and SSH stay enabled — but they're only reachable from the hardened ops server through ASG-restricted paths. No direct access from workstations or the internet.

### Questions for OSC

1. **Does OSC have any WinRM/SSH use cases beyond what ITS raised?** (OSC-specific tooling, scripts, automation?)
2. **Does OSC operate any servers independently from ITS?** (Or is all infra managed by ITS centrally?)
3. **AVD licensing:** Does OSC already have Windows E3/E5 or M365 E3/E5? (Covers AVD entitlement)
4. **Bastion:** Any existing Bastion deployments in OSC subscriptions?
5. **Arc:** Are any OSC servers already Arc-enabled?

---

## Follow-Up from Last Meeting (5/28 — Kristen SSPR/WHfB)

### Open Action Items
| Owner | Action | Due | Status |
|-------|--------|-----|--------|
| Kristen | Confirm desk phone / Teams Phone PSTN reachability | 5/28 week | ❓ Check today |
| Kristen | Identify hardware OATH pilot group (~50 users) + budget owner | 1 week (6/4) | ❓ Check today |
| Kristen | Confirm M365 environment (commercial vs GCC) | 5/28 week | ❓ Check today |
| AG | Deliver hardware OATH provisioning runbook | 1 week (6/4) | ❓ |
| AG | Deliver WHfB non-destructive PIN reset architecture diagram | 1 week (6/4) | ❓ |
| AG | Deliver SSPR tenant policy config doc | 1 week (6/4) | ❓ |
| AG | Schedule technical workshop | 2 weeks (6/11) | ❓ |

---

## Live Notes


---

## Action Items
| Owner | Action | Due Date |
|-------|--------|----------|
| | | |

## Next Steps
- Next bi-weekly: 2026-06-15
