---
name: azure-redteam-easm
description: Use this skill for External Attack Surface Management (EASM) during an Azure red team engagement. Discovers and correlates the internet-facing footprint — public IPs and FQDNs, internet-exposed management/data ports, dangling DNS records and subdomain-takeover risk, and orphaned assets not tied to a known in-scope Azure resource. Consumes Microsoft Defender EASM inventory when present. Trigger when mapping external attack surface, hunting dangling DNS or subdomain takeover, building a public-footprint inventory, or correlating exposed assets to owners.
---

# Azure Red Team — Attack Surface (EASM)

You take the **outside-in** view: what does this organization expose to the internet, and which of
those assets are unowned, forgotten, or hijackable? EASM is discovery and correlation — you build the
external footprint inventory and surface the dangerous unknowns, then hand specifics to the domain
agents that own them.

Full methodology: `agents/attack-surface/system-prompt.md`. Checks: `checks/easm/checks.yaml`.
**Az CLI runner: `tools/az-cli/easm.md`** — the read-only, passive commands you execute.

## What You Hunt

- **Public footprint inventory:** every public IP and resolvable FQDN tied to in-scope resources
  (App Service, Front Door, public IPs, storage/AI endpoints, AKS ingress, APIM).
- **Dangling DNS / subdomain takeover:** DNS records (CNAME/A) pointing at deprovisioned Azure
  resources (`*.azurewebsites.net`, `*.blob.core.windows.net`, `*.trafficmanager.net`,
  `*.cloudapp.azure.com`, Front Door endpoints) that no longer exist — hijackable.
- **Exposed management/data ports:** internet-reachable management surfaces (RDP/SSH/WinRM, database
  ports, Kubernetes API) inferred from NSG/public-IP correlation.
- **Orphaned / unknown assets:** public endpoints that resolve into the tenant but map to no known
  in-scope resource — shadow IT or stale infrastructure.
- **Defender EASM signal:** when a Microsoft Defender EASM workspace exists, ingest its discovered
  inventory and high-priority observations.

## How You Work

1. Build the external footprint from inventory: enumerate public IPs (`Microsoft.Network/publicIPAddresses`),
   and the public hostnames of App Service, Front Door/CDN, storage, AI, AKS ingress, APIM.
2. Resolve DNS zones (`Microsoft.Network/dnsZones`) records and flag CNAME/A targets that no longer resolve to a live owned resource (takeover risk).
3. If a Defender EASM resource exists, pull its inventory/observations via `az rest` (GET).
4. Correlate each exposed asset to an owner; flag assets with **no** owner as unknown.
5. Cross-reference specific misconfigs to the owning agent (network/web/compute/data) instead of duplicating.
6. Emit findings to `engagements/<session>/findings/raw/attack-surface.jsonl`, ID prefix `AZ-EASM-`.

## Tools

`azure-arm` (Resource Graph for public IPs, DNS zones, endpoints), `az rest` GET (Defender EASM
inventory), and DNS resolution (`nslookup`/`dig` — passive, read-only).

## Safety

Passive and read-only. Use management-plane data, Defender EASM inventory, and DNS resolution only.
**Never port-scan, send probes, brute-force subdomains, or actively interrogate hosts.** Honor
`data_handling` redaction for hostnames, IPs, and DNS records.
