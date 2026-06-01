# Email: WinRM/SSH Solution Design — PAW + Jump Server Architecture

**To:** OSC / ITS Team
**From:** AG
**Subject:** WinRM/SSH Management — Proposed Solution Architecture

---

Hi Team,

Following our discussion today, I wanted to document the solution we aligned on for securing WinRM and SSH management access while preserving all existing operational workflows.

## The Approach

**We are not disabling WinRM or SSH.** Your tools, scripts, and operational workflows continue to work. What changes is **how administrators reach the servers** — we're collapsing the management path to a single, hardened route.

## Architecture

```
Dedicated Win11 PAW (WHfB 2FA) → RDP → On-Prem Jump Server → WinRM/SSH → Target Servers
```

### Layer 1 — Privileged Access Workstation (PAW)

- Dedicated Windows 11 workstation for administrative use only
- Windows Hello for Business provides phishing-resistant 2FA at login (TPM-bound key + PIN/biometric)
- Hardened: no email, no browsing, no personal use — admin tasks only
- Protected by Defender for Endpoint with attack surface reduction rules
- **Only device authorized to RDP to the jump server** — firewall rules block all other sources

### Layer 2 — On-Premises Jump Server

- Windows Server, domain-joined, on the management network
- Active Directory security group controls who can RDP in
- Azure Arc-enabled for monitoring and Defender for Servers P2 visibility
- **Outbound only:** WinRM (HTTPS 5986) and SSH (22) to target server subnets
- Full event logging forwarded to Sentinel for audit

### Layer 3 — Target Servers (DCs, Members, Linux)

- Firewall rules restrict WinRM and SSH to **only accept connections from the jump server IP**
- All other sources are denied — no direct WinRM/SSH from workstations or other servers
- No changes to existing server configurations or tooling

## Network Access Rules

| Source | Destination | Port | Rule |
|---|---|---|---|
| PAW subnet | Jump server | RDP (3389) | Allow |
| All other subnets | Jump server | RDP (3389) | Deny |
| Jump server | Domain Controllers | WinRM HTTPS (5986) | Allow |
| Jump server | Member Servers | WinRM HTTPS (5986) | Allow |
| Jump server | Linux Servers | SSH (22) | Allow |
| All other sources | Target servers | WinRM / SSH | Deny |

## How This Addresses Each Concern

| Concern | How it's addressed |
|---|---|
| **Existing tools depend on WinRM** | Tools run from the jump server — same WinRM, just routed through the hardened path |
| **Need interactive PowerShell Remoting** | Full PS Remoting from jump server to targets — no capability loss |
| **Hybrid environment needs consistent management** | Jump server is on-prem — same network as all targets, Azure and on-prem |
| **Azure-native tools aren't 1:1 replacements** | We're not replacing WinRM — we're securing the path to it |
| **Disabling WinRM causes operational risk** | WinRM stays enabled — only the network access is restricted |
| **SSH needed for sudoers, SFTP, RHEL config** | SSH stays enabled — restricted to jump server source only |

## Why This Design

- **No cloud dependency for management** — if ExpressRoute or Azure has an outage, the PAW and jump server are fully on-prem. You can still manage your servers.
- **2FA without PIM or Azure Portal** — Windows Hello for Business on the PAW is multi-factor authentication at the device level. No sync delays, no cloud calls required.
- **No new infrastructure** — a dedicated workstation and a hardened server. No AVD, no Bastion, no NPS server roles.
- **Phishing-resistant** — WHfB credentials can't be phished, replayed, or stolen over the wire.
- **Fully auditable** — every RDP session to the jump server and every WinRM/SSH session to targets is logged and forwarded to Sentinel.

## Monitoring Stack

- **Defender for Servers P2** on jump server and targets
- **Defender for Identity** on Domain Controllers
- **Azure Monitor Agent (AMA)** collecting logs to Log Analytics / Sentinel
- **Azure Arc** on jump server for Azure-plane visibility and inventory

## Next Steps

1. **ITS to provide:** Tool inventory — which specific tools run on the jump server for WinRM management
2. **ITS to provide:** Server counts by OS and location — to scope firewall rule deployment
3. **ITS ISO to confirm:** Security policy requirements are met by this architecture
4. **AG to deliver:** Detailed firewall ACL templates for the jump server and target subnets
5. **Schedule:** Working session to plan Phase 1 deployment (PAW + jump server + firewall rules)

Happy to walk through any of this in more detail. Let me know if you have questions.

Best,
AG
