# Azure Attack Matrix (MITRE ATT&CK for Cloud / Azure)

A reference mapping of Azure attack techniques to the agents and checks that detect related misconfigurations. Based on the MITRE ATT&CK Cloud matrix adapted for Azure / Entra ID.

## Initial Access

| Technique | ID | Azure manifestation | Detected by |
|---|---|---|---|
| Exploit Public-Facing Application | T1190 | Exposed VMs, public PaaS, no WAF | Network Exposure |
| Valid Accounts (Cloud) | T1078.004 | Stolen Entra credentials, no MFA | Identity Posture |
| External Remote Services | T1133 | RDP/SSH open to internet | Network Exposure |
| Phishing | T1566 | Targets users without MFA | Identity Posture (MFA gaps) |

## Execution

| Technique | ID | Azure manifestation | Detected by |
|---|---|---|---|
| Cloud Administration Command | T1651 | VM runCommand, Automation runbooks | Authorization & Attack Path, Compute |
| Container Administration Command | T1609 | kubectl exec, AKS admin | Compute Platform |
| Serverless Execution | T1648 | Function App abuse | Compute Platform |

## Persistence

| Technique | ID | Azure manifestation | Detected by |
|---|---|---|---|
| Account Manipulation | T1098 | Add app credentials, role assignments | Authorization, Identity |
| Additional Cloud Credentials | T1098.001 | New SP secrets/certs | Identity Posture |
| Additional Cloud Roles | T1098.003 | Self-granted RBAC roles | Authorization & Attack Path |
| Create Account | T1136.003 | Rogue guest/user creation | Identity Posture |

## Privilege Escalation

| Technique | ID | Azure manifestation | Detected by |
|---|---|---|---|
| Valid Accounts | T1078 | Over-permissioned principals | Authorization & Attack Path |
| Abuse Elevation Control | T1548 | roleAssignments/write self-escalation | Authorization & Attack Path |
| Domain/Tenant Policy Modification | T1484 | CA policy tampering | Identity Posture |

## Defense Evasion

| Technique | ID | Azure manifestation | Detected by (coverage gap) |
|---|---|---|---|
| Impair Defenses | T1562 | Defender plans off | Logging & Coverage |
| Disable Cloud Logs | T1562.008 | Diagnostic settings removed | Logging & Coverage |
| Modify Cloud Compute Infrastructure | T1578 | Snapshot/disk manipulation | Compute Platform |

## Credential Access

| Technique | ID | Azure manifestation | Detected by |
|---|---|---|---|
| Brute Force / Password Spray | T1110 | Legacy auth, no lockout | Identity Posture |
| Unsecured Credentials | T1552 | Secrets in app settings, shared keys | Compute, Data Protection |
| Cloud Secrets Management Stores | T1555.006 | Key Vault over-exposure | Data Protection, Authorization |
| Steal Application Access Token | T1528 | Managed identity token theft | Authorization & Attack Path |

## Discovery

| Technique | ID | Azure manifestation | Detected by |
|---|---|---|---|
| Cloud Infrastructure Discovery | T1580 | Resource enumeration | (used by Inventory agent) |
| Cloud Service Discovery | T1526 | Service mapping | Inventory & Scope |
| Permission Groups Discovery | T1069.003 | RBAC enumeration | Authorization & Attack Path |

## Lateral Movement

| Technique | ID | Azure manifestation | Detected by |
|---|---|---|---|
| Use Alternate Authentication Material | T1550 | Token/key reuse | Authorization & Attack Path |
| Internal Spearphishing / pivot | T1021 | VNet peering, flat networks | Network Exposure |

## Collection / Exfiltration / Impact

| Technique | ID | Azure manifestation | Detected by |
|---|---|---|---|
| Data from Cloud Storage | T1530 | Public blobs, exposed DBs | Data Protection |
| Transfer Data to Cloud Account | T1537 | Exfil to attacker storage | Data Protection, Logging |
| Data Destruction | T1485 | Purge Key Vault, delete resources | Data Protection |
| Data Encrypted for Impact | T1486 | Ransomware on storage | Data Protection |

## Usage

Each check in `checks/` maps to one or more of these techniques via its `controls.mitre` field. The Reporting Agent uses these mappings to produce ATT&CK-aligned findings that defenders can correlate with their detection coverage.
