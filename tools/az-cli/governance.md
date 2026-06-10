# Governance & Posture — Az CLI Assessment Runner
# Agent: `azure-redteam-governance` · Checks: `checks/governance/checks.yaml`
#
# Control-plane posture is read from Azure Policy, Defender for Cloud, Management Groups,
# and resource locks. Requires `Reader` + `Security Reader` (and `Management Group Reader`
# for hierarchy). All commands are read-only (list/show/`az rest --method GET`).

## CHK-GOV-POLICY-COVERAGE — Baseline policy guardrails present
```bash
# Assignments at the in-scope subscription (and any management group scope).
az policy assignment list --scope "/subscriptions/<subId>" -o json
# Flag: no assignment referencing a security initiative (e.g. Microsoft Cloud Security
# Benchmark / Azure Security Benchmark), or all assignments enforcementMode=DoNotEnforce.
az policy assignment list --scope "/providers/Microsoft.Management/managementGroups/<mg>" -o json
```

## CHK-GOV-POLICY-EXEMPTIONS — Broad or never-expiring exemptions
```bash
az policy exemption list --scope "/subscriptions/<subId>" -o json
# Flag: exemptions with no expiresOn, category 'Waiver' on a security initiative, or scoped
# at subscription/MG level rather than a single resource.
```

## CHK-GOV-SECURE-SCORE-LOW — Secure score + unhealthy recommendations
```bash
az security secure-scores list -o json
# Fallback: `az security secure-scores list` is extension/API-version dependent and
# can return empty even when Defender for Cloud is enabled. If so, read the score
# directly from ARM (the well-known score name is 'ascScore'):
az rest --method GET \
  --url "https://management.azure.com/subscriptions/<subId>/providers/Microsoft.Security/secureScores/ascScore?api-version=2020-01-01" -o json
az security assessment list -o json
# Flag: secure score percentage below engagement threshold, or High-severity assessments
# with status.code == 'Unhealthy'. Treat an empty CLI result as "use the REST fallback",
# not as "no finding". (Plan on/off coverage is owned by logging:
# CHK-LOG-DEFENDER-DISABLED — do not re-flag it here.)
```

## CHK-GOV-MG-HIERARCHY-GUARDRAILS — Management-group hierarchy depth
```bash
az account management-group list -o json
az account management-group show --name <mg> --expand --recurse -o json
# Read the hierarchy via ARM if the CLI extension is unavailable:
az rest --method GET \
  --url "https://management.azure.com/providers/Microsoft.Management/managementGroups?api-version=2021-04-01" -o json
# Flag: in-scope subscription is a direct child of the tenant root MG, or no intermediate
# group carries policy/RBAC assignments.
```

## CHK-GOV-NO-RESOURCE-LOCKS — Missing locks on critical resources
```bash
az lock list -o json                                  # subscription scope
az lock list --resource-group <rg> -o json            # per critical resource group
# Flag: critical resource groups/resources with no CanNotDelete or ReadOnly lock.
```

## CHK-GOV-MG-RBAC-INHERITANCE — Broad standing privilege at MG/root
```bash
az role assignment list \
  --scope "/providers/Microsoft.Management/managementGroups/<mg>" \
  --include-inherited -o json
# Flag: Owner / Contributor / User Access Administrator assigned at root or a top-level MG,
# especially to a group, guest, or service principal (inherited by all child subscriptions).
```

## CHK-GOV-NO-SECURITY-CONTACT — Defender for Cloud notification owner
```bash
az security contact list -o json
# Flag: no contact with a notification email, or alert notifications disabled.
```

## CHK-GOV-NO-CIS-COMPLIANCE-STANDARD — No CIS benchmark standard monitored
```bash
az rest --method GET \
  --url "https://management.azure.com/subscriptions/<subId>/providers/Microsoft.Security/regulatoryComplianceStandards?api-version=2019-01-01-preview" -o json
# Flag: no CIS (or other benchmark) standard present, or only default/empty standards
# with no passed/failed control state — i.e. no benchmark assessment is running.
```

## CHK-GOV-NO-DEFENDER-CSPM-PLAN — Defender CSPM (foundational posture) plan off
```bash
az security pricing show -n CloudPosture -o json
# Or read directly from ARM:
az rest --method GET \
  --url "https://management.azure.com/subscriptions/<subId>/providers/Microsoft.Security/pricings/CloudPosture?api-version=2024-01-01" -o json
# Flag: pricingTier=='Free' (Defender CSPM not enabled), or posture extensions
# (agentless scanning, attack-path analysis) not enabled. (Workload-protection plans
# Servers/Storage/SQL/Containers/KeyVault/AppServices/Arm are owned by logging:
# CHK-LOG-DEFENDER-DISABLED — do not re-flag them here.)
```

## CHK-GOV-NO-VULN-POSTURE-MGMT — Vulnerability posture (agentless/VA) not in effect
```bash
az security assessment list -o json
# Or via ARM, then filter to VA-related assessments:
az rest --method GET \
  --url "https://management.azure.com/subscriptions/<subId>/providers/Microsoft.Security/assessments?api-version=2021-06-01" -o json
az security sub-assessment list -o json
# Flag: assessments such as 'Machines should have a vulnerability assessment solution'
# / 'Container registry images should have vulnerability findings resolved' are absent
# or Unhealthy with unremediated high-severity sub-assessments.
```
