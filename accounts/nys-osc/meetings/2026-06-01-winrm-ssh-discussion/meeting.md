# Meeting Packet — 2026-06-01 — OSC WinRM/SSH Discussion

## Meeting Info
- **Date:** 2026-06-01
- **Account:** nys-osc (shared with ITS infrastructure)
- **Type:** Technical Discussion
- **Attendees:** TBD
- **Related:** ITS solution design — [2026-05-28-solution-design-winrm-ssh-lockdown.md](../../nys-its/questions/2026-05-28-solution-design-winrm-ssh-lockdown.md)

## Decision & Outcome
- **Single decision needed:** Agree on the approach — lock down WinRM/SSH network paths rather than disable the protocols
- **Best-case outcome:** OSC/ITS endorses the hardened management path architecture (Bastion → AVD Ops Server → targets via ASG-restricted WinRM/SSH)
- **Fallback outcome:** ITS provides tool inventory so we can map each dependency to an Azure-native equivalent

---

## Team Complaints — Point-by-Point with Microsoft Response

### Windows Server Team — WinRM

---

#### W1. Existing operational and security tooling depends on WinRM

**Their position:** Endpoint, configuration, monitoring, and Tier 0 operational tools rely on WinRM. Workflows are embedded in production processes and cannot be fully migrated without service impact.

**Our response:**

We agree — and we're **not asking you to rip out WinRM**. The goal is to **remove WinRM from the network attack surface** while keeping it fully functional for your tools.

**What changes:** HOW you reach the servers. Not WHAT runs on them.

| Today (risky) | Proposed (hardened) |
|---|---|
| Admin workstation → WinRM direct to server | Admin → Entra MFA + PIM → Bastion → AVD Ops Server → WinRM to server |
| WinRM open on server NIC | WinRM restricted via NSG/ASG to ops server only |
| Flat network path | Segmented — only the ops management ASG can talk WinRM |

**Action needed from ITS:** Provide the **tool inventory** — which specific tools depend on WinRM? We need to map each one:
- Tools that can run from the AVD ops server → no change needed, just move the execution point
- Tools that need server-to-server WinRM → ASG rule between automation servers and targets
- Tools that genuinely need ARM/Arc replacement → we plan migration per-tool

---

#### W2. ARM Run Command doesn't meet real-time operational requirements

**Their position:** ARM Run Command is ad-hoc only. They need interactive troubleshooting, real-time log retrieval, and full PowerShell Remoting sessions for outages and Tier 0 ops.

**Our response:**

Correct — ARM Run Command is not a replacement for interactive PowerShell Remoting. **We're not proposing it as one.**

The interactive replacement stack:

| Need | Solution |
|---|---|
| Interactive remote troubleshooting | **Azure Bastion Premium** → RDP/SSH into AVD ops server → PowerShell Remoting from there to targets. Full interactive session, session recording included. |
| Real-time log retrieval | **Azure Monitor Agent (AMA)** + Log Analytics for continuous collection. For ad-hoc: PowerShell Remoting from ops server. |
| Secure authenticated PS Remoting | **WinRM over HTTPS (5986)** stays enabled — restricted to ops server ASG. Same PS Remoting, just routed through the hardened path. |
| Emergency Tier 0 access | **PIM just-in-time elevation** + Bastion → ops server → DC. Time-bound, MFA-enforced, fully audited. |

**Key point:** You keep PowerShell Remoting. You keep WinRM. The protocol stays — the network exposure goes away.

---

#### W3. Hybrid environments require consistent management paths

**Their position:** They manage Azure VMs + on-prem DCs + member servers. ARM Run Command only applies to Azure VMs. No single unified management plane exists.

**Our response:**

This is exactly what **Azure Arc** solves:

| Server Location | Without Arc | With Arc |
|---|---|---|
| Azure VM | ARM Run Command, Azure Monitor, Update Manager | Same |
| On-prem DC | WinRM from workstation (no centralized control) | Arc agent → Run Command, Machine Config, Update Manager, Defender, Monitor — **same control plane as Azure** |
| On-prem member server | WinRM from workstation | Same as above |

Arc brings **every server** — Azure, on-prem, other cloud — into one management plane. It doesn't replace WinRM on the wire; it gives you an Azure-native API layer above it.

**Recommendation:** Pilot Arc on 10-20 non-critical servers first. Validate that Run Command v2 + Machine Config + Monitor covers the day-to-day. Then expand.

**WinRM still works in the interim** — Arc is additive, not a rip-and-replace.

---

#### W4. Azure-native options aren't functionally equivalent replacements

**Their position:** Update Manager, Machine Config, Automation Runbooks, and Bastion each solve narrow parts. None provide fully interactive remote command execution, per-session shell access, module-based PowerShell management, or complex diagnostics.

**Our response:**

Fair critique — no single Azure tool replaces "open a PS Remoting session and troubleshoot." That's why the architecture **preserves WinRM** and adds security around it:

| Capability | Tool | Notes |
|---|---|---|
| Interactive per-session shell | **Bastion → AVD ops server → PS Remoting** | Same experience as today, just routed securely |
| Module-based PowerShell mgmt | **PS Remoting from ops server** (WinRM stays) | Install modules on ops server, remote into targets |
| Complex diagnostics | **PS Remoting** + **VM Insights** + **AMA-collected ETL/events** in Log Analytics | Query rather than remote-pull for most cases |
| Patching at scale | **Azure Update Manager** | Replaces WSUS/SCCM patching workflows |
| Config drift detection | **Arc Machine Configuration** | Declarative — detects and remediates drift continuously |
| Ad-hoc script execution | **Arc Run Command v2** | Parameterized scripts, module imports, output streaming |

**The honest answer:** For interactive troubleshooting, WinRM stays. We just lock down who can reach it and from where.

---

#### W5. Disabling WinRM today would cause operational risk

**Their position:** Multiple processes, automations, and emergency operations depend on WinRM. Premature removal would impact DC and critical infrastructure ops.

**Our response:**

**We agree.** That's why we're proposing a **phased approach**, not a cutover:

| Phase | What happens | WinRM status |
|---|---|---|
| **Phase 1 — Lock down** | Deploy AVD ops server + Bastion. NSG/ASG rules restrict WinRM to ops server + automation servers only. Deploy AMA + Defender for Servers P2. | ✅ Enabled — network-restricted |
| **Phase 2 — Inventory + migrate** | Tool-by-tool inventory. Migrate workflows with Azure-native replacements (patching → Update Manager, config → Machine Config, ad-hoc → Run Command/Bastion). | ✅ Enabled — shrinking dependency |
| **Phase 3 — Residual assessment** | Identify workflows with no Azure replacement. Accept with compensating controls OR build PS Remoting-over-SSH alternative. | ✅ Enabled where needed |
| **Phase 4 — Disable where possible** | Disable WinRM only on servers with zero remaining dependency. | ❌ Disabled (only where safe) |

**Timeline:** Phase 1 can start immediately. Phase 4 may be months or years out for some servers — and that's fine.

---

### Enterprise Server Services (ESS) Team — SSH

---

#### E1. Sudoers distribution via SCP from on-prem git server

**Their position:**
```
sudo -u unixagent scp -q /aix/prod/sudo/sudoers "$SERVER":/tmp/sudoers
```
Without SSH, they'd manually edit sudoers on each Azure server.

**Our response:**

Several options, from least disruptive to most modern:

| Option | Disruption | How |
|---|---|---|
| **A. Keep SSH — lock it down** | Lowest | NSG restricts SSH to on-prem git server IP + Bastion subnet only. Add Entra login for Linux VMs (cert-based, no static keys). SSH stays, attack surface shrinks. |
| **B. Arc Run Command from pipeline** | Medium | Git hook triggers Azure DevOps / GitHub Actions pipeline → `Invoke-AzConnectedMachineRunCommand` pushes sudoers via Arc agent. No inbound SSH needed. |
| **C. Arc Machine Configuration** | Medium | Declare sudoers state in a Machine Config package. Arc agent enforces it continuously — no push needed at all. Drift auto-remediates. |
| **D. Pull-based via Azure Files** | Medium | Servers pull sudoers from an Azure Files share (mounted via managed identity) on a cron schedule. Git hook uploads to the share instead of SCP'ing. |

**Recommendation for ITS:** Start with **Option A** (lock down SSH, keep the workflow). Plan migration to **Option C** (Machine Config) for long-term — it eliminates the push model entirely and adds drift detection.

---

#### E2. PeopleSoft COBOL/SQR DR sync via SFTP

**Their position:** Automated SFTP job syncs production PeopleSoft files from on-prem to Azure DR servers on a schedule.

**Our response:**

| Option | How |
|---|---|
| **A. Azure Blob Storage with SFTP endpoint** | Microsoft-managed SFTP service. Existing SFTP workflow stays, but target is PaaS (audited, managed, no VM SSH exposure). DR servers mount via blobfuse/NFS 3.0. |
| **B. Azure Files with on-prem sync** | Azure File Sync agent on-prem → syncs to Azure Files share → DR servers mount the share. No SFTP needed. |
| **C. Keep SFTP on DR servers — lock down** | NSG restricts SSH/SFTP to on-prem source IP only. Add key rotation + Entra cert auth. |
| **D. AzCopy / Storage Mover on schedule** | One-way sync from on-prem to blob. DR servers pull from blob. |

**Recommendation:** **Option A** (Blob SFTP endpoint) — keeps the team's existing SFTP workflow but removes SSH from the DR servers entirely. Managed service, audited, no VM exposure.

---

#### E3. RHEL build/config script — remote SSH commands for server hardening

**Their position:**
```
ssh -q $SERVER 'update-crypto-policies --set DEFAULT:DISABLE-CBC:NO-SHA1'
ssh -q $SERVER 'echo MPSRV1:/... >> /etc/fstab'
ssh -q $SERVER 'chmod 600 /etc/sssd/sssd.conf'
```
Manual configuration would be tedious and error-prone.

**Our response:**

**Best-practice answer: don't configure servers after build — bake it into the image.**

| Layer | Tool | What it does |
|---|---|---|
| **Build-time** | **Azure Image Builder + Shared Image Gallery** | Create a hardened golden RHEL image with all standards pre-applied. Every new server starts compliant. |
| **First-boot** | **cloud-init / custom data** | VM provisioning injects the remaining config (fstab, site-specific settings) at first boot. No SSH needed. |
| **Ongoing drift** | **Arc Machine Configuration** | Continuous enforcement — if someone changes crypto policies or sssd.conf permissions, Machine Config detects and remediates automatically. |
| **Ad-hoc** | **VM Custom Script Extension** or **Arc Run Command** | Same SSH commands, but executed via ARM control plane. No inbound SSH. |

**Recommendation:** Combine **golden image + cloud-init + Machine Config**. This eliminates the SSH dependency for builds AND adds ongoing compliance enforcement that the current SSH script approach doesn't provide.

---

## Cross-Cutting Summary for OSC/ITS

### The core message

| | What they fear | What we're actually proposing |
|---|---|---|
| **WinRM** | "You're taking away our management tool" | WinRM stays. We lock down the network path to it. |
| **SSH** | "We'll have to manually configure everything" | SSH stays short-term. We offer Azure-native alternatives that are better than SSH for each use case. |
| **Timeline** | "This is a rip-and-replace" | Phased approach. Phase 1 is purely additive — no workflows break. |

### What we need from ITS/OSC

| Item | Why | Who |
|---|---|---|
| **Tool inventory** (W1) | Map each WinRM-dependent tool to Azure-native equivalent or ops server model | ITS Windows Server team |
| **Server counts** by OS (Win/Linux), location (Azure/on-prem) | Size Arc + Bastion + AVD deployment | ITS |
| **ISO security policy** on inbound management ports | Understand the compliance requirement driving this | ITS ISO |
| **OSC-specific automation** | Any OSC tools/scripts beyond ITS-managed infra? | OSC |

---

## Live Notes

### Solution Presented to OSC: On-Prem Jump Server + Arc + JIT

Proposed simplified architecture to OSC:

```
Admin → Entra MFA + PIM → JIT request (Defender for Servers P2) → On-prem jump server (Arc-enabled) → WinRM/SSH to targets
```

- Use an **existing on-prem server** as the management jump point (no AVD needed)
- **Azure Arc** connects it to Azure management plane
- **Defender for Servers P2 JIT** controls access — port closed by default, time-bound opening per admin request
- WinRM/SSH stays fully functional from the jump server to all targets (DCs, members, Linux)
- All existing ITS tools and workflows continue working — just routed through the hardened path

**JIT on Arc-enabled servers:** Uses Windows Firewall / iptables rules on the machine itself (not Azure NSGs). Requires Arc agent current + Defender P2 assigned + host firewall enabled.

**Key requirement:** This must be the **single path** to managed servers — admins cannot bypass the jump server and WinRM/SSH directly from workstations. On-prem firewall ACLs enforce this.

### Follow-Up: Validation Questions for Sundeep (Azure Infra Engineer)

Need to validate the solution with Sundeep before finalizing:

1. **Does JIT VM Access work on Arc-enabled on-prem servers?** Any gotchas or limitations vs Azure VM JIT?
2. **Arc agent + Defender P2 — sufficient for JIT, or additional prerequisites?** (agent versions, firewall service requirements, connectivity back to Azure?)
3. **Can JIT scope port opening to a specific source IP** (requesting admin's IP) on Arc-enabled servers, same as Azure VMs?
4. **Tier 0 trust level concerns?** This box will have WinRM access to DCs — does Defender P2 + Arc give enough monitoring/hardening?
5. **Network segmentation enforcement** — recommend on-prem firewall ACLs restricting WinRM/SSH from jump server only, or is there an Azure-native way through Arc?


---

## Action Items
| Owner | Action | Due Date |
|-------|--------|----------|
| AG | Follow up with Chris Kirk on Attack Disruption false positive | TBD |
| ITS | Provide tool inventory — which tools depend on WinRM and can't use ARM/Arc | Before next meeting |
| ITS | Provide server counts by OS and location (Azure vs on-prem) | Before next meeting |
| ITS ISO | Clarify security policy on inbound management ports | Before next meeting |
| AG | Prepare Arc + Bastion + AVD ops server sizing estimate once server counts received | After ITS provides counts |
| AG | Prepare sample Machine Config package for sudoers enforcement (E1) | 2 weeks |

## Next Steps
- ITS provides tool inventory and server counts
- AG delivers architecture sizing + Machine Config sample
- Schedule ITS + ISO + Microsoft working session to walk through Phase 1 deployment
