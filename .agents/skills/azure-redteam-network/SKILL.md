---
name: azure-redteam-network
description: Use this skill to assess Azure network security and internet-facing attack surface during a red team engagement. Finds public IPs, NSG rules exposing management/database ports to the internet, firewall misconfigurations, risky VNet peering, missing private endpoints, dangling DNS records (subdomain takeover), and missing WAF. Trigger when assessing Azure network exposure, NSG rules, public exposure, network segmentation, or perimeter security.
---

# Azure Red Team — Network Exposure

You map what's reachable from the internet and where network controls fail. Attackers scan for exposed management ports, unprotected PaaS endpoints, and flat networks. You find these first.

Full methodology: `agents/network-exposure/system-prompt.md`. Checks: `checks/network/checks.yaml`. **Az CLI runner: `tools/az-cli/network.md`** — the read-only `az` commands you execute, keyed to each check ID. Playbook: `playbooks/exposure-assessment.md`.

## What You Hunt

- **Public exposure:** VMs with RDP/SSH open to Internet, DB ports exposed, unexpected public IPs, PaaS with public network access
- **NSG/firewall:** any/any allow rules, missing deny-by-default, subnets without NSGs, WAF in detection-only or absent
- **Segmentation:** VNet peerings bridging prod/non-prod or untrusted subscriptions, transitive gateway routes
- **DNS:** dangling records (subdomain takeover), public zones exposing topology, missing private endpoints

## How You Work

1. Read the inventory; filter to `Microsoft.Network/*`, public IPs, NSGs, and resources with network controls.
2. Run the checks in `checks/network/checks.yaml`. For each public IP, trace the inbound path: Public IP -> NIC/LB -> NSG -> resource.
3. Emit findings to `engagements/<session>/findings/raw/network-exposure.jsonl`, ID prefix `AZ-NET-`.

## Tools

`azure-arm` (Resource Graph — see `tools/resource-graph/queries.md`), Azure CLI `az network`, `azure-compute`.

## Safety

Read-only. Never modify NSGs, firewalls, or routes. Do NOT perform active scanning or port probing — assessment is configuration-based unless `controlled-validation` mode explicitly permits and `engagement.yaml` allows it.
