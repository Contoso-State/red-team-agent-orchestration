# Playbook: Public Exposure Assessment

**Goal:** Map the complete internet-facing attack surface of the target Azure environment and identify which exposed resources are exploitable entry points.

**Owner:** Network Exposure Agent (lead), with Data Protection and Compute Platform agents.

**Mode required:** `read-only-assessment` (or higher).

## Why this matters

External attackers start by scanning for what's reachable. Every public IP, open management port, and internet-facing PaaS endpoint is a potential entry point. This playbook enumerates exposure systematically so nothing slips through.

## Steps

### 1. Enumerate all public-facing resources
From the inventory, identify:
- Public IP addresses and what they attach to
- Resources with `publicNetworkAccess = Enabled` (Storage, Key Vault, SQL, Cosmos, App Service)
- Load balancers, App Gateways, Front Door, Traffic Manager endpoints
- App Services and Function Apps (public by default)

Run: `CHK-NET-PUBLIC-IP-UNEXPECTED`, `CHK-STOR-PUBLIC-NETWORK`, `CHK-STOR-PUBLIC-BLOB`, `CHK-DB-SQL-PUBLIC-NETWORK`.

### 2. Analyze the inbound path for each public resource
For every public IP, trace: Public IP → NIC/LB → NSG rules → resource. Identify open ports and source ranges.

Run: `CHK-NET-MGMT-PORT-INTERNET`, `CHK-NET-DB-PORT-INTERNET`, `CHK-NET-ANY-ANY-RULE`.

### 3. Check for unauthenticated access
A public endpoint with no auth is an open door:
- Anonymous storage containers (`CHK-STOR-ANON-CONTAINER`)
- App Services without auth (`CHK-COMP-APPSVC-NO-AUTH`)
- Web endpoints without WAF (`CHK-NET-WAF-MISSING`)

### 4. Hunt for takeover opportunities
- Dangling DNS records (`CHK-NET-DANGLING-DNS`) — subdomain takeover
- ACR/registries with anonymous pull

### 5. Rank exposure by exploitability
Order findings: unauthenticated + sensitive data > management port exposed > public endpoint with auth. Hand the top entry points to the Authorization & Attack Path Agent as potential chain starting points.

## Output

A ranked external attack surface map. Each entry: resource, exposure type, open ports, authentication state, and whether it's a viable entry point for an attack chain.

## MITRE Mapping

T1190 (Exploit Public-Facing Application), T1133 (External Remote Services), T1530 (Data from Cloud Storage), T1584.001 (Domain/subdomain takeover).
