# NYS ITS — WinRM and SSH Management Scenarios

**Date received:** 2026-05-28
**Requested by:** ITS (forwarded by Mohammed Abdelhadi)
**Source teams:** Windows Server team, Enterprise Server Services (ESS) team
**Proposed meeting:** ITS + ISO (Information Security Office) + Microsoft
**Status:** Open — awaiting solution discussion

ITS Windows Server and ESS teams have raised concerns about disabling WinRM (Windows) and SSH (Linux) on Azure VMs. They've provided concrete scenarios that current Azure-native alternatives don't fully address. Goal of upcoming meeting: walk through each scenario, agree on secure Azure-native patterns, identify any remaining gaps.

---

## Windows Server Team — Why WinRM Is Required

### W1. Existing operational and security tooling depends on WinRM
Endpoint, configuration, monitoring, and Tier 0 operational tools (some not yet supported via ARM or Azure-native control planes) rely on WinRM for secure remote execution, data gathering, and state reporting. Workflows are embedded in production processes.

**Discussion points / candidate solutions:**
- Inventory of tools — which specifically don't support ARM/Arc? (Need list to map each to Azure-native equivalent.)
- **Azure Arc-enabled servers** extends ARM control plane to on-prem and hybrid — enables Run Command, Machine Configuration, Update Manager, and Defender across all servers.
- **Arc Custom Script Extension** for one-off automation parity with existing WinRM workflows.
- For SIEM/monitoring: **Azure Monitor Agent (AMA) + Defender for Servers P2** consolidates state reporting and telemetry without WinRM.
- For Tier 0 secure remote execution: **Azure Bastion + JIT VM access via Defender for Servers** + **PIM** for time-bound elevated access.

### W2. ARM Run Command does not meet all real-time operational requirements
ARM Run Command is for ad hoc actions and small scripts — not continuous management, large-scale orchestration, or DC-level real-time troubleshooting.

**Cited needs:**
- Interactive remote troubleshooting
- Real-time log retrieval
- Secure, authenticated PowerShell Remoting sessions

**Discussion points / candidate solutions:**
- **Azure Bastion (Standard/Premium)** with native client RDP/SSH supports interactive PowerShell remoting over a secure tunnel — no public IP, no WinRM-over-internet, MFA via Entra ID. Premium adds session recording.
- **Azure Update Manager** for patching orchestration at scale.
- **Azure Automation State Configuration / Machine Configuration (Arc + Guest Config)** for continuous configuration drift detection and remediation.
- **Real-time log retrieval:** Azure Monitor Logs (Log Analytics) with AMA + Sentinel data connectors instead of remote log pulls.
- **PowerShell Remoting over SSH** (Win Server 2019+) as an alternative transport if WinRM is the concern, not remote PS itself.

### W3. Hybrid environments require consistent management paths
Environment includes hybrid + on-prem DCs, member servers, infrastructure. ARM Run Command only applies to Azure VMs. Other proposed services don't deliver a single, unified plane.

**Discussion points / candidate solutions:**
- **Azure Arc** is exactly this — it brings Azure-native management (Run Command, Update Manager, Machine Config, Defender, Monitor, Policy, Sentinel onboarding) to on-prem and other cloud servers under one control plane.
- Recommend Arc onboarding pilot for DC and member server fleet — keeps WinRM disabled while preserving unified ops.

### W4. Some Azure-native options aren't functionally equivalent replacements
Update Manager, Machine Config, Automation Runbooks, and Bastion each solve narrow parts. None provide fully interactive remote command execution, per-session shell access, module-based PowerShell management, or complex diagnostics without prebuilt runbooks.

**Discussion points / candidate solutions:**
- **Azure Bastion Premium** delivers per-session interactive shell access (RDP + SSH) with no inbound WinRM/RDP exposure.
- For module-based PowerShell management: **Arc + Run Command v2** supports parameterized scripts and module imports; combined with **PowerShell 7 + DSC** via Machine Config for declarative drift.
- For complex diagnostics: **VM Insights** + **Connection Monitor** + **AMA-collected ETL/event logs** in Log Analytics — query rather than remote-pull.
- Compensating control if WinRM stays enabled: **WinRM over HTTPS only**, **NSG restricted to Bastion subnet**, **Entra ID-based admin via Just-In-Time + PIM**, **Defender for Servers monitoring**.

### W5. Disabling WinRM today would cause operational risk
Multiple internal processes, automations, and emergency operations depend on WinRM. Premature removal would impact DC and critical infrastructure ops.

**Discussion points / candidate solutions:**
- Acknowledge — propose phased migration plan, not immediate disablement.
- **Phase 1:** Onboard servers to Azure Arc, deploy AMA, enable Defender for Servers P2, lock WinRM to private network/Bastion only (no public exposure).
- **Phase 2:** Tool-by-tool inventory; migrate workflows that have native Azure replacements (patching → Update Manager; config → Machine Config; ad-hoc → Run Command/Bastion).
- **Phase 3:** Identify residual WinRM-dependent workflows; either accept with compensating controls or build PowerShell Remoting-over-SSH replacement.
- **Phase 4:** Disable WinRM where residual dependency = zero.

---

## Enterprise Server Services (ESS) Team — Why SSH Is Required

### E1. Sudoers file distribution via SCP from on-prem git server
Git hook runs from on-prem git server and SCPs the updated sudoers file to all Azure servers after commit:
```
sudo -u unixagent scp -q /aix/prod/sudo/sudoers "$SERVER":/tmp/sudoers
```
Without SSH, ESS would manually edit sudoers on each Azure server.

**Discussion points / candidate solutions:**
- **Azure Arc + Machine Configuration** with a custom configuration package to enforce sudoers state declaratively — eliminates push-based SCP entirely.
- **Ansible via Arc** — Arc supports Ansible playbooks targeting Arc-enabled servers (no inbound SSH needed; uses Arc agent).
- **Azure DevOps / GitHub Actions pipeline** triggered on git commit → uses Arc `Run Command` (or `Invoke-AzVMRunCommand` for Azure VMs) to push the file via the management plane, not SSH.
- **Azure Files / Blob with managed identity** — servers pull the sudoers file on schedule (cron) from a hardened, audited source instead of being SCP'd to.
- If SSH must remain: lock it down to **Azure Bastion only** + **Microsoft Entra login for Linux VMs** (no static SSH keys; Entra-issued certs with PIM/JIT).

### E2. ERP Admin team — SFTP sync for PeopleSoft COBOL/SQR DR replication
Automated job SFTPs production PeopleSoft files from on-prem to DR servers in Azure on a schedule to keep DR 100% in sync.

**Discussion points / candidate solutions:**
- **Azure Files (NFS or SMB) with on-prem sync** via Azure File Sync — DR servers mount the share; no SFTP needed.
- **Azure Blob with SFTP endpoint enabled** (managed service) — keeps the existing SFTP workflow but offloads transport to a managed, audited PaaS service. Servers can mount via blobfuse/NFS 3.0 if needed.
- **Storage Mover / AzCopy on a schedule** for one-way sync from on-prem source.
- **Pull-based pattern:** DR servers fetch via managed identity from blob/files instead of being pushed to via SFTP.
- If SSH/SFTP must remain on DR servers: same lockdown as E1 — Bastion-only, Entra-issued credentials.

### E3. RHEL build/config script — remote SSH commands for server hardening
Example commands sent via SSH during new server build:
```
ssh -q $SERVER 'update-crypto-policies --set DEFAULT:DISABLE-CBC:NO-SHA1'
ssh -q $SERVER 'echo MPSRV1:/... >> /etc/fstab'
ssh -q $SERVER 'chmod 600 /etc/sssd/sssd.conf'
```
Manual configuration would be tedious and error-prone.

**Discussion points / candidate solutions:**
- **Cloud-init / custom data** at VM provisioning time — bakes the standards in at first boot, no inbound SSH needed.
- **Azure Image Builder / Shared Image Gallery** — create a hardened golden RHEL image; all new servers start compliant.
- **Azure Arc Machine Configuration** with a Linux configuration package to enforce these settings continuously (not just at build).
- **Azure VM Custom Script Extension** runs the same commands via ARM control plane (no inbound SSH).
- **Ansible from Arc** or **Azure Automation** for orchestrated post-build configuration.
- Combine: golden image + cloud-init for build-time + Machine Config for drift = no inbound SSH dependency.

---

## Cross-Cutting Themes for the Meeting

1. **The Microsoft answer is largely Azure Arc + Azure Bastion + Machine Configuration + Defender for Servers P2.** All three scenarios converge on this stack.
2. **Security position:** the goal is to remove inbound management ports (WinRM/SSH) from the network attack surface — not to remove the *capability* of remote management. Arc/Bastion provide identical capability through the management plane.
3. **Compensating controls if disable is not yet possible:** private networking only (no public IPs), NSG restrict to Bastion subnet, Entra-based admin with PIM/JIT, Defender for Servers monitoring, WinRM-over-HTTPS, SSH key rotation via Entra login for Linux.
4. **Licensing implications to confirm before meeting:**
   - Azure Arc — free for core; per-server cost for some extensions
   - Defender for Servers P2 — per server/hour
   - Bastion Standard vs Premium — Premium needed for session recording
   - Entra login for Linux VMs — included with VM
5. **Need from ITS:**
   - Tool inventory (W1) — which tools don't yet support ARM/Arc
   - Server count by OS (Win/Linux, Azure/on-prem) — to size Arc + Bastion
   - Current ISO security policy on inbound management ports

---

## Action Items
| Owner | Action | Due |
|-------|--------|-----|
| AG | Pre-meeting: prepare Arc + Bastion + Machine Config architecture sketch addressing W1–W5 and E1–E3 | Before meeting |
| AG | Confirm latest Azure Arc Linux Machine Config GA status & sample sudoers configuration package | Before meeting |
| Mohammed | Confirm meeting time with ITS + ISO + AG | TBD |
| ITS | Provide tool inventory (W1) and Azure/hybrid server counts | At/before meeting |
