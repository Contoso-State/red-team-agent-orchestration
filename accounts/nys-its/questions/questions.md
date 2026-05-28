# Customer Questions Template

Track open questions, customer-asked questions, and your follow-up questions for this account.

## Format
Use one file per topic/meeting, or maintain a running log. Suggested naming: `YYYY-MM-DD-topic.md`

---

## Open Questions (Awaiting Customer Response)

| # | Date Asked | Question | Asked By | Status | Answer / Notes |
|---|------------|----------|----------|--------|----------------|
| 1 | | | | Open | |

## Questions From Customer (Need Our Response)

| # | Date Asked | Question | Owner | Due | Response |
|---|------------|----------|-------|-----|----------|
| 1 | 2026-05-28 | Windows Server team: 5 reasons why WinRM is required for server management (tooling, ARM Run Command gaps, hybrid mgmt, functional equivalence, operational risk of disablement). See [2026-05-28-winrm-ssh-management-scenarios.md](2026-05-28-winrm-ssh-management-scenarios.md) (W1–W5). | AG | Meeting w/ ITS+ISO TBD | Draft: Arc + Bastion + Machine Config + Defender P2 stack; phased disablement plan |
| 2 | 2026-05-28 | ESS team: SSH/SCP needed for sudoers distribution from on-prem git server. See [2026-05-28-winrm-ssh-management-scenarios.md](2026-05-28-winrm-ssh-management-scenarios.md) (E1). | AG | Meeting w/ ITS+ISO TBD | Draft: Arc Machine Config for declarative sudoers, or Arc Run Command via pipeline |
| 3 | 2026-05-28 | ERP Admin team: SFTP DR sync for PeopleSoft COBOL/SQR files to Azure DR servers. See [2026-05-28-winrm-ssh-management-scenarios.md](2026-05-28-winrm-ssh-management-scenarios.md) (E2). | AG | Meeting w/ ITS+ISO TBD | Draft: Azure Files w/ Sync, or Blob SFTP endpoint, or pull-based w/ managed identity |
| 4 | 2026-05-28 | ESS team: SSH used for RHEL build/config script (crypto policies, fstab, file permissions). See [2026-05-28-winrm-ssh-management-scenarios.md](2026-05-28-winrm-ssh-management-scenarios.md) (E3). | AG | Meeting w/ ITS+ISO TBD | Draft: cloud-init + golden image + Arc Machine Config for ongoing drift |

## Technical Deep-Dive Questions

_Architecture, integration, licensing, sizing, etc._

- **WinRM / SSH management scenarios** — Windows Server team + ESS team raised 8 scenarios requiring inbound WinRM/SSH on Azure VMs. Full breakdown with candidate Azure-native solutions in [2026-05-28-winrm-ssh-management-scenarios.md](2026-05-28-winrm-ssh-management-scenarios.md). Pending meeting with ITS + ISO.
- **Working solution design** — pragmatic ITS-aligned approach (keep WinRM/SSH, lock down with ASG/NSG + AVD ops server + Bastion + identity hardening) in [2026-05-28-solution-design-winrm-ssh-lockdown.md](2026-05-28-solution-design-winrm-ssh-lockdown.md)
- Core stack proposed: **AVD (ops mgmt server) + Bastion + ASG/NSG + gMSA + PIM/JIT + Defender for Identity/Servers P2 + Sentinel**, with **Azure Arc** as additive long-term play
- Open data needed from ITS: tool inventory (what doesn't support ARM/Arc), server counts by OS/location, ISO policy on inbound mgmt ports, existing AD tier/PIM model

## Business / Procurement Questions

_Budget, timeline, decision process, stakeholders, etc._

-

## Resolved Questions

| Date Resolved | Question | Resolution |
|---------------|----------|------------|
| | | |
