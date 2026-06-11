# Azure Kubernetes Service (AKS) Security Baseline — Posture Reference

Reference knowledge for the **Azure Container & Kubernetes Agent (`aks-container`)**. It maps the
Microsoft AKS security baseline (Microsoft cloud security benchmark, MCSB) and AKS operator
best-practice guidance to the read-only checks in `checks/container/checks.yaml`, and frames where
the hard-gated cluster-active lane (Lane 2) confirms what the posture lane can only infer.

> **Sources (Microsoft Learn, official first-party).**
> - Azure Kubernetes Service security baseline — `https://learn.microsoft.com/security/benchmark/azure/baselines/azure-kubernetes-service-aks-security-baseline`
> - Best practices for cluster security and upgrades in AKS — `https://learn.microsoft.com/azure/aks/operator-best-practices-cluster-security`
> - Center for Internet Security (CIS) Kubernetes benchmark for AKS — `https://learn.microsoft.com/azure/aks/cis-kubernetes`
> - Azure Well-Architected Framework — AKS service guide (Security) — `https://learn.microsoft.com/azure/well-architected/service-guides/azure-kubernetes-service#security`
>
> These are Microsoft baseline/benchmark references, not third-party harvested methodology. Active
> in-cluster technique detail lives in `knowledge/kubernetes-security.md` and
> `knowledge/container-security.md` and carries the upstream Apache-2.0 attribution.

---

## 1. How the baseline maps to our posture checks

The MCSB AKS baseline is organized into control families. We assess the subset that is observable
read-only from the Azure control plane and the Kubernetes API.

| MCSB family | Baseline expectation | Our read-only checks |
|---|---|---|
| Network Security (NS) | Private cluster or authorized IP ranges on the API server; NetworkPolicy enforced; no flat pod network | `CHK-COMP-AKS-PUBLIC-API`, `CHK-COMP-AKS-NO-NETPOL`, `CHK-COMP-CONTAINER-PRIVILEGED-INGRESS` |
| Identity Management (IM) | Entra ID integration; disable local accounts; managed identity (not admin user) for ACR pull | `CHK-COMP-AKS-LOCAL-ADMIN`, `CHK-COMP-ACR-ADMIN-USER` |
| Privileged Access (PA) | Azure RBAC for Kubernetes; least-privilege in-cluster RBAC; just-in-time admin | `CHK-COMP-AKS-NO-ENTRA-RBAC`, `CHK-COMP-AKS-RBAC-CLUSTER-ADMIN-SPRAWL` |
| Data Protection (DP) | Secrets via Secrets Store CSI + Key Vault; KMS etcd encryption; no plaintext secrets in manifests | `CHK-CNTR-NO-CSI-SECRETS` |
| Asset Management (AM) | Image integrity / admission control (Azure Policy for AKS, image cleaner, signature verification) | `CHK-CNTR-NO-IMAGE-INTEGRITY`, `CHK-COMP-ACR-NO-CONTENT-TRUST` |
| Posture & Vulnerability Management (PV) | Defender for Containers; scan-on-push; supported Kubernetes/node-image version; Pod Security Standards | `CHK-COMP-ACR-NO-DEFENDER-SCAN`, `CHK-COMP-CONTAINER-IMAGE-VULN`, `CHK-COMP-AKS-OUTDATED-VERSION`, `CHK-COMP-AKS-NO-POD-SECURITY` |
| Identity/Workload | Workload Identity (OIDC) so pods don't inherit the node managed identity via IMDS | `CHK-COMP-AKS-NODE-MI-EXPOSURE` |

## 2. Baseline control highlights

### Network security
- **Private cluster or authorized IP ranges.** The API server should not be reachable from the open
  internet. Prefer a private cluster; if public, restrict `apiServerAccessProfile.authorizedIpRanges`
  to known administrative CIDRs (`CHK-COMP-AKS-PUBLIC-API`).
- **NetworkPolicy.** Enable a network policy engine (Azure NPM, Calico, or Cilium) so pod-to-pod
  traffic is segmented rather than flat (`CHK-COMP-AKS-NO-NETPOL`). Also use it to block pod egress to
  the IMDS endpoint `169.254.169.254` (links to workload-identity exposure below).
- **Ingress control.** External ingress should be fronted by WAF/Front Door/App Gateway with IP
  restrictions; a privileged workload with open external ingress is a high-value target
  (`CHK-COMP-CONTAINER-PRIVILEGED-INGRESS`).

### Identity & privileged access
- **Entra integration, local accounts disabled.** `disableLocalAccounts: true` removes the static
  admin kubeconfig escape hatch; authentication should flow through Entra ID
  (`CHK-COMP-AKS-LOCAL-ADMIN`).
- **Azure RBAC for Kubernetes.** `aadProfile.enableAzureRBAC: true` lets Azure role assignments drive
  in-cluster authorization, centralizing least privilege (`CHK-COMP-AKS-NO-ENTRA-RBAC`). In-cluster
  RBAC sprawl (cluster-admin bound widely, wildcard ClusterRoles) is the in-cluster counterpart
  (`CHK-COMP-AKS-RBAC-CLUSTER-ADMIN-SPRAWL`; see `knowledge/kubernetes-security.md` §3).
- **ACR pull by identity, not admin user.** Prefer the `AcrPull` role on the kubelet/managed identity
  over the shared registry admin user (`CHK-COMP-ACR-ADMIN-USER`).

### Workload identity vs node managed identity
- Enable the **OIDC issuer** and **Workload Identity** so each workload gets its own federated,
  least-privilege identity. Without it, a compromised pod reaches IMDS and inherits the node pool's
  kubelet managed identity and every Azure role it holds (`CHK-COMP-AKS-NODE-MI-EXPOSURE`; detail in
  `knowledge/kubernetes-security.md` §5).

### Data protection
- **Secrets Store CSI driver + Key Vault.** Source secrets from Key Vault via the
  `azureKeyvaultSecretsProvider` add-on rather than baking them into manifests, ConfigMaps, or env
  vars (`CHK-CNTR-NO-CSI-SECRETS`). Consider KMS etcd encryption (`azureKeyVaultKms`) for
  secret-at-rest protection.

### Posture & vulnerability management
- **Defender for Containers.** The subscription `Containers` plan provides registry vulnerability
  assessment and runtime threat detection (`CHK-COMP-ACR-NO-DEFENDER-SCAN`,
  `CHK-COMP-CONTAINER-IMAGE-VULN`). Plan *enablement* at the subscription level is owned by
  Governance & Posture; we assess cluster/registry-scoped coverage.
- **Supported versions.** Keep the control plane and node images on a supported, patched
  Kubernetes minor (`CHK-COMP-AKS-OUTDATED-VERSION`).
- **Pod Security Standards.** Enforce `baseline`/`restricted` Pod Security Admission on workload
  namespaces; disallow privileged/host-namespace/hostPath pods (`CHK-COMP-AKS-NO-POD-SECURITY`;
  detail in `knowledge/kubernetes-security.md` §4).

### Asset management & image integrity
- **Admission control.** Enforce that only approved/signed images run — Azure Policy for AKS
  (Gatekeeper), Ratify/Notation signature verification, or Kyverno — and enable the image cleaner to
  evict stale vulnerable images (`CHK-CNTR-NO-IMAGE-INTEGRITY`).
- **Registry trust.** Content trust, quarantine, and tag immutability on ACR
  (`CHK-COMP-ACR-NO-CONTENT-TRUST`; detail in `knowledge/container-security.md` §4).

## 3. CIS Kubernetes benchmark on AKS

Microsoft publishes how AKS maps to the **CIS Kubernetes benchmark**. On AKS the control plane and
etcd are managed by Microsoft, so customer-actionable CIS controls concentrate on **worker node
configuration, RBAC, Pod Security, and policy**. The read-only lane infers many of these from the
control plane and Kubernetes API; the gated **Lane 2 `cluster-benchmark` tier** runs `kube-bench`
(CIS) and `kubesec` (manifest risk) against a live, in-scope cluster to *confirm* them
(`CHK-CNTR-KUBE-BENCH-CIS`, `CHK-CNTR-MANIFEST-RISK`). See `knowledge/kubernetes-security.md` §6 for
the tooling and the cluster-active gating model.

## 4. Posture lane vs cluster-active lane (what confirms what)

| Baseline question | Read-only signal (Lane 1) | Confirmation (Lane 2, gated) |
|---|---|---|
| Are nodes CIS-compliant? | Kubernetes version, PSA labels, RBAC objects | `kube-bench` CIS run (`CHK-CNTR-KUBE-BENCH-CIS`, tier `cluster-benchmark`) |
| Are running manifests risky? | `kubectl get pods -A -o json` securityContext review | `kubesec` scoring of live manifests (`CHK-CNTR-MANIFEST-RISK`, tier `cluster-benchmark`) |
| Do deployed images have CVEs? | Defender assessment list | Offline `trivy`/`grype` on pulled ACR digests (`CHK-CNTR-IMAGE-CVE-DEEP`, tier `image-scan`) |
| Is a SA token over-reachable? | `automountServiceAccountToken`, RBAC | Read-only in-pod token reachability (`CHK-CNTR-SA-TOKEN-REACH`, tier `runtime-probe`) |
| What's actually inside the pod? | (not observable read-only) | Benign read-only inventory via ephemeral debug container (`CHK-CNTR-RUNTIME-INVENTORY`, tier `runtime-probe`) |

Lane 2 is **off by default** and runs only under `mode: cluster-active-testing` with an enabled,
authorized `cluster_testing` block and a non-empty Azure-derived cluster allowlist — enforced
fail-closed by the cluster guardrail. See `agents/aks-container/system-prompt.md` for the full gate.
