# Attribution Map — Anthropic-Cybersecurity-Skills

This file maps the upstream skill guides from
[mukul975/Anthropic-Cybersecurity-Skills](https://github.com/mukul975/Anthropic-Cybersecurity-Skills)
(Apache-2.0, author *mahipal*, pinned commit `04450304b12645cb2b974ab96d28c0664758a88d`)
to the artifacts in this repository whose content they informed.

See [`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md) for the license notice.

We harvested **methodology** (read-only commands, detection logic, control mappings),
not source files. Each row records the upstream skill and where its substance now lives
here. Active/exploit techniques are captured as knowledge or routed to the gated
External Vulnerability Agent (EVA) lane — never into a default read-only runner.

| Upstream skill | Our domain | Our artifacts |
|---|---|---|
| auditing-azure-active-directory-configuration | identity | `checks/identity/checks.yaml`, `tools/az-cli/identity.md`, `knowledge/entra-attack-techniques.md` |
| detecting-azure-service-principal-abuse | identity | `checks/identity/checks.yaml`, `tools/az-cli/identity.md` |
| implementing-azure-ad-privileged-identity-management | identity | `checks/identity/checks.yaml`, `tools/az-cli/identity.md` |
| implementing-conditional-access-policies-azure-ad | identity | `checks/identity/checks.yaml`, `tools/az-cli/identity.md` |
| implementing-passwordless-auth-with-microsoft-entra | identity | `knowledge/entra-attack-techniques.md` |
| building-identity-federation-with-saml-azure-ad | identity | `knowledge/oauth-saml-jwt.md` |
| detecting-suspicious-oauth-application-consent | identity | `checks/identity/checks.yaml`, `knowledge/entra-attack-techniques.md` |
| detecting-compromised-cloud-credentials | identity | `knowledge/entra-attack-techniques.md` |
| detecting-azure-lateral-movement | rbac | `checks/rbac/checks.yaml`, `knowledge/azure-attack-matrix.md` |
| detecting-azure-storage-account-misconfigurations | storage | `checks/storage/checks.yaml`, `tools/az-cli/storage.md` |
| detecting-misconfigured-azure-storage | storage | `checks/storage/checks.yaml`, `tools/az-cli/storage.md` |
| auditing-kubernetes-cluster-rbac | compute | `checks/compute/checks.yaml`, `knowledge/kubernetes-security.md` |
| implementing-rbac-hardening-for-kubernetes | compute | `knowledge/kubernetes-security.md` |
| implementing-kubernetes-pod-security-standards | compute | `checks/compute/checks.yaml`, `knowledge/kubernetes-security.md` |
| scanning-kubernetes-manifests-with-kubesec | compute | `knowledge/kubernetes-security.md`, `tools/preflight/check-environment.mjs` |
| performing-kubernetes-cis-benchmark-with-kube-bench | compute | `knowledge/kubernetes-security.md`, `tools/preflight/check-environment.mjs` |
| securing-kubernetes-on-cloud | compute | `knowledge/kubernetes-security.md` |
| performing-kubernetes-penetration-testing | compute | `knowledge/kubernetes-security.md` (active → knowledge only) |
| scanning-containers-with-trivy-in-cicd | compute / supplychain | `checks/compute/checks.yaml`, `knowledge/container-security.md` |
| securing-container-registry-images | compute | `checks/compute/checks.yaml`, `knowledge/container-security.md` |
| detecting-container-escape-attempts | compute | `knowledge/container-security.md` |
| hardening-docker-containers-for-production | compute | `knowledge/container-security.md` |
| analyzing-azure-activity-logs-for-threats | logging | `checks/logging/checks.yaml`, `tools/az-cli/logging.md` |
| building-cloud-siem-with-sentinel | logging | `checks/logging/checks.yaml`, `tools/az-cli/logging.md` |
| securing-azure-with-microsoft-defender | logging | `checks/logging/checks.yaml`, `tools/az-cli/logging.md` |
| implementing-azure-defender-for-cloud | logging | `checks/logging/checks.yaml`, `tools/az-cli/logging.md` |
| auditing-cloud-with-cis-benchmarks | governance | `checks/governance/checks.yaml`, `knowledge/cloud-posture-benchmarks.md` |
| implementing-cloud-security-posture-management | governance | `checks/governance/checks.yaml`, `knowledge/cloud-posture-benchmarks.md` |
| implementing-cloud-vulnerability-posture-management | governance | `knowledge/cloud-posture-benchmarks.md` |
| performing-cloud-asset-inventory-with-cartography | governance | `knowledge/cloud-posture-benchmarks.md`, `tools/preflight/check-environment.mjs` |
| conducting-cloud-penetration-testing | governance | `knowledge/cloud-posture-benchmarks.md` (active → knowledge only) |
| implementing-secret-scanning-with-gitleaks | supplychain | `checks/supplychain/checks.yaml`, `knowledge/container-security.md`, `tools/preflight/check-environment.mjs` |
| exploiting-oauth-misconfiguration | external-vuln | `knowledge/oauth-saml-jwt.md` (EVA-gated) |
| testing-oauth2-implementation-flaws | external-vuln | `knowledge/oauth-saml-jwt.md` (EVA-gated) |
| exploiting-jwt-algorithm-confusion-attack | external-vuln | `knowledge/oauth-saml-jwt.md` (EVA-gated) |
| testing-jwt-token-security | external-vuln | `knowledge/oauth-saml-jwt.md` (EVA-gated) |

> The rows above describe the **intended** mapping for this integration. As individual
> phases land, the referenced artifacts are created/extended; rows remain accurate to
> the upstream→repo relationship even where an artifact name is introduced by a later phase.
