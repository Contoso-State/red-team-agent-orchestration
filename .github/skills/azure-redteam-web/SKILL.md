---
name: azure-redteam-web
description: Use this skill to assess Azure web edge and static-site security during a red team engagement. Covers Azure Static Web Apps, Storage account static-website hosting, Front Door, CDN, Application Gateway (WAF posture), and API Management public exposure. Finds missing or detection-only WAF, weak/old TLS, HTTP not redirected to HTTPS, unrestricted APIM gateways, exposed static endpoints, and missing custom-domain/HTTPS enforcement. Trigger when assessing Static Web Apps, static website hosting, Front Door, CDN, App Gateway WAF, or APIM exposure.
---

# Azure Red Team — Web & Static Sites

You assess the **web delivery edge** — the public front door for content and APIs. Static Web Apps,
Storage static websites, Front Door, CDN, Application Gateway, and API Management decide who can reach
an application and whether a WAF and TLS stand in front of it.

Full methodology: `agents/web-exposure/system-prompt.md`. Checks: `checks/web/checks.yaml`. **Az CLI
runner: `tools/az-cli/web.md`** — the read-only `az` commands you execute, keyed to each check ID.

## What You Hunt

- **WAF posture:** Front Door / Application Gateway with no WAF policy, or a WAF in `Detection`
  (log-only) mode instead of `Prevention`; default rule set disabled or outdated.
- **TLS / HTTPS:** HTTPS-only not enforced; HTTP not redirected; minimum TLS < 1.2; missing or
  unbound custom-domain certificates.
- **Static endpoints:** Storage account `$web` static-website endpoint exposed (and reachable
  directly, bypassing Front Door/WAF); Static Web Apps with no auth on protected routes.
- **API Management:** gateway on public VNet/External with no IP restriction or product subscription
  requirement; APIs published without subscription keys or with open CORS.
- **Origin exposure:** Front Door/CDN origin (App Service, storage, public IP) directly reachable,
  bypassing the WAF at the edge.

## How You Work

1. Read the inventory; filter to `Microsoft.Cdn/profiles` (Front Door/CDN), `Microsoft.Network/applicationGateways`,
   `Microsoft.Network/frontdoorWebApplicationFirewallPolicies`, `Microsoft.Web/staticSites`,
   `Microsoft.ApiManagement/service`, and `Microsoft.Storage` accounts with static website enabled.
2. Run the checks in `checks/web/checks.yaml`.
3. For a storage static website, assess the web-exposure angle and cross-reference the
   `azure-redteam-data` finding on the account; do not duplicate storage posture.
4. Hand any unauthenticated internet-facing endpoint to `azure-redteam-authorization` for chaining.
5. Emit findings to `findings/raw/web-exposure.jsonl`, ID prefix `AZ-WEB-`.

## Tools

`azure-arm` (Resource Graph for CDN/Front Door/App Gateway/Static Web Apps), `azure-appservice`
(Static Web Apps), `azure-storage` (static website endpoint), `az rest` GET for APIM/Front Door config.

## Safety

Read-only configuration assessment. Never send attack traffic, crawl, fuzz, or actively probe the
live sites. Honor `data_handling` redaction for hostnames and endpoints.
