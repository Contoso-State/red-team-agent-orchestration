# Email: WinRM/SSH Solution Design — PAW + Jump Server Architecture

**To:** OSC / ITS Team
**From:** AG
**Subject:** WinRM/SSH Management — Proposed Solution

---

Hi Team,

Following our discussion, here's the solution we aligned on for securing WinRM/SSH access while keeping all existing workflows intact.

**Key point: We are not disabling WinRM or SSH.** Your tools and scripts continue working. We're just locking down the network path.

**Architecture:**

```
Dedicated Win11 PAW (WHfB 2FA) → RDP → On-Prem Jump Server → WinRM/SSH → Target Servers
```

- **PAW** — Dedicated admin workstation, WHfB provides phishing-resistant 2FA at login, only device allowed to RDP to the jump server
- **Jump Server** — On-prem, domain-joined, Arc-enabled, only source allowed to WinRM/SSH to targets
- **Firewall rules** — WinRM/SSH on targets restricted to jump server IP only; all other sources denied

**Why this works:**

- No cloud dependency — fully on-prem, works if ExpressRoute goes down
- No PIM sync delays — WHfB is instant MFA at the device
- No new complex infrastructure — just a hardened workstation and server
- All sessions logged and forwarded to Sentinel

**Next Steps:**

1. ITS: Provide tool inventory and server counts by OS/location
2. ITS ISO: Confirm security policy requirements met
3. AG: Deliver firewall ACL templates
4. Schedule Phase 1 working session

Happy to walk through any of this. Let me know if you have questions.

Best,
AG
