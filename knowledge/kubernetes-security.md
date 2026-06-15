# Kubernetes & AKS Security — Attack Surface, RBAC Abuse, and Benchmark Methodology

Reference knowledge for the **Azure Container & Kubernetes Agent (`aks-container`)** when assessing
Azure Kubernetes Service (AKS) and the Kubernetes workloads running on it. It frames the
attack surface, the read-only hunts our checks perform, and the **active / manual**
techniques — which are *knowledge only* in the default read-only lane and, where the agent's
hard-gated **cluster-active lane** is explicitly authorized, are confined to that lane (§8).

> **Attribution.** The methodology below was harvested from the Apache-2.0
> [`mukul975/Anthropic-Cybersecurity-Skills`](https://github.com/mukul975/Anthropic-Cybersecurity-Skills)
> project (author *mahipal*, pinned commit `04450304b12645cb2b974ab96d28c0664758a88d`) —
> specifically the `auditing-kubernetes-cluster-rbac`,
> `implementing-rbac-hardening-for-kubernetes`,
> `implementing-kubernetes-pod-security-standards`,
> `scanning-kubernetes-manifests-with-kubesec`,
> `performing-kubernetes-cis-benchmark-with-kube-bench`,
> `securing-kubernetes-on-cloud`, and `performing-kubernetes-penetration-testing` skills.
> We re-expressed the *methodology* (read-only commands, detection logic, control mappings)
> in this repository's structures; we did not copy their `SKILL.md` or Python files. See
> [`../THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md) and
> [`ATTRIBUTION.md`](ATTRIBUTION.md).

---

## 1. AKS attack surface (control plane to node)

| Layer | Exposure | Related checks |
|---|---|---|
| API server | Public endpoint, no authorized IP ranges, not private | `CHK-COMP-AKS-PUBLIC-API` |
| Authn/Authz | Local accounts / admin kubeconfig bypass Entra; no Azure RBAC for K8s | `CHK-COMP-AKS-LOCAL-ADMIN`, `CHK-COMP-AKS-NO-ENTRA-RBAC` |
| In-cluster RBAC | cluster-admin sprawl, wildcard ClusterRoles, binds to `system:authenticated` | `CHK-COMP-AKS-RBAC-CLUSTER-ADMIN-SPRAWL` |
| Workload identity | OIDC/Workload Identity off → pods inherit node MI via IMDS | `CHK-COMP-AKS-NODE-MI-EXPOSURE` |
| Pod security | No Pod Security Admission, privileged/host pods | `CHK-COMP-AKS-NO-POD-SECURITY` |
| Network | No NetworkPolicy → flat pod-to-pod traffic | `CHK-COMP-AKS-NO-NETPOL` |
| Patch level | Unsupported/outdated Kubernetes / node image | `CHK-COMP-AKS-OUTDATED-VERSION` |

The Azure ARM control plane permission `…/listClusterAdminCredential/action` is a separate
escalation primitive owned by the Authorization & Attack Path agent
(`CHK-RBAC-AKS-CLUSTER-ADMIN`); pulling the admin kubeconfig bypasses Kubernetes RBAC
entirely. Treat that as the bridge between Azure RBAC and in-cluster RBAC.

## 2. MITRE ATT&CK techniques (Containers matrix)

| ID | Technique | Manifestation in AKS |
|---|---|---|
| T1610 | Deploy Container | Attacker schedules a pod (privileged) to gain execution |
| T1611 | Escape to Host | Privileged/hostPath/host-namespace pod breaks out to the node |
| T1609 | Container Administration Command | `kubectl exec`, admin kubeconfig, API server abuse |
| T1613 | Container and Resource Discovery | Enumerate namespaces, secrets, RBAC, service accounts |
| T1525 | Implant Internal Image | Malicious image pushed to ACR and deployed |
| T1098.006 | Account Manipulation: Additional Container Cluster Roles | Self-grant cluster-admin / wildcard ClusterRole bindings |
| T1552.007 | Unsecured Credentials: Container API | Service-account token / kubelet creds / IMDS node MI token |
| T1078.004 | Valid Accounts: Cloud Accounts | Node/kubelet managed identity reused from a compromised pod |
| T1068 | Exploitation for Privilege Escalation | Known CVE in unpatched kubelet / control plane |

## 3. RBAC abuse and audit (read-only)

In-cluster RBAC is a primary privilege-escalation and lateral-movement vector. Audit it
read-only with `kubectl get … -o json` (and optionally the `rbac-tool` kubectl plugin's
`who-can` queries, which are read-only):

- **cluster-admin sprawl** — enumerate `ClusterRoleBindings` whose `roleRef.name` is
  `cluster-admin`; the bound non-system subjects should be a tiny break-glass set.
- **wildcard ClusterRoles** — custom (non `system:`) ClusterRoles with `verbs: ['*']` and
  `resources: ['*']` are cluster-admin under another name.
- **dangerous verbs** — `bind`, `escalate`, and `impersonate` allow a subject to grant
  itself more access; `secrets` `get/list` enables credential theft; `pods/exec` and
  `create pods` enable code execution / container escape.
- **everyone bindings** — any binding whose subject is `system:authenticated` or
  `system:unauthenticated` exposes that role to all (or anonymous) callers.
- **service-account token mounts** — pods with `automountServiceAccountToken: true` that do
  not call the API give a compromised container a usable token; prefer
  `automountServiceAccountToken: false`.

Hardening (from `implementing-rbac-hardening-for-kubernetes`): least privilege via
namespaced `Role`/`RoleBinding`, eliminate ClusterRoleBindings for non-admins, separate
service accounts per workload, integrate Entra groups via Azure RBAC for Kubernetes, and
continuously re-audit.

## 4. Pod Security Standards (PSS) / Pod Security Admission (PSA)

Kubernetes 1.25+ enforces three profiles via namespace labels:

| Profile | Intent |
|---|---|
| `privileged` | Unrestricted — system components only |
| `baseline` | Blocks known escalations: no privileged, hostNetwork/PID/IPC, hostPath, host ports, dangerous capabilities |
| `restricted` | Hardened: runAsNonRoot, drop ALL capabilities, seccomp RuntimeDefault, read-only rootfs |

Enforcement modes are `enforce` (reject), `audit` (log), and `warn`. Read-only detection:
`kubectl get ns -L pod-security.kubernetes.io/enforce` for namespace labels, and
`kubectl get pods -A -o json` to find pods that set `privileged: true`, host namespaces,
`hostPath` volumes, or `runAsNonRoot != true`. A workload namespace with **no**
`enforce=baseline|restricted` label, or any privileged/host pod, fails
`CHK-COMP-AKS-NO-POD-SECURITY`.

## 5. Workload Identity vs node managed identity

Without Entra **Workload Identity** (OIDC issuer + workload-identity webhook), pods reach
the instance metadata endpoint (`169.254.169.254`) and obtain a token for the node pool's
kubelet/VMSS **managed identity** — so any compromised pod inherits whatever Azure roles
that node identity holds. Read-only signals (`CHK-COMP-AKS-NODE-MI-EXPOSURE`):
`oidcIssuerProfile.enabled`, `securityProfile.workloadIdentity.enabled`, the
`identityProfile.kubeletidentity` object ID, and that identity's
`az role assignment list`. Remediation: enable Workload Identity, give each workload its
own federated identity with least privilege, block pod egress to IMDS with a NetworkPolicy,
and minimize the kubelet identity's role assignments.

## 6. Benchmark & manifest tooling (optional, read-only accelerators)

These are **optional**; our checks never require them and never install them. They are
read-only assessment accelerators:

- **kube-bench** (Aqua) — runs the **CIS Kubernetes Benchmark** against control plane,
  etcd, worker nodes, and policies, producing pass/fail/warn. On AKS the control plane is
  managed, so focus on the node and policy controls. Use to corroborate
  `CHK-COMP-AKS-OUTDATED-VERSION` and PSS findings.
- **kubesec** (ControlPlane) — static **manifest** risk scoring (privileged, host mounts,
  capabilities, `allowPrivilegeEscalation`, missing `readOnlyRootFilesystem`). A
  static-analysis aid for `CHK-COMP-AKS-NO-POD-SECURITY`; run against exported manifests,
  not the live cluster.
- **kubescape** — scans against the NSA/CISA and other frameworks for PSS compliance.

Mentioning them is fine; requiring them is not. The runner stays on `kubectl get/describe`,
`kubectl auth can-i --list`, and `az aks show`.

## 7. Active / manual Kubernetes penetration testing — KNOWLEDGE ONLY

> ⚠️ The techniques below are **active/offensive** and are documented here for the
> assessor's situational awareness and for the report's "what an attacker would do next"
> narrative. They are **NOT** runner checks and must **NOT** be added to any `tools/az-cli`
> runner. They run, if at all, only under an explicitly authorized engagement and by a
> human — never automatically. Derived from `performing-kubernetes-penetration-testing`.

- **API server / kubelet probing** — `kube-hunter`, anonymous kubelet read-only port
  (`:10255`) and authenticated `:10250` `exec`/`run` abuse.
- **In-cluster privilege escalation** — `peirates`, abusing `pods/exec`, `create pods` with
  a privileged/hostPath spec, mounting the host filesystem, or stealing service-account
  tokens from `/var/run/secrets/kubernetes.io/serviceaccount/`.
- **Container escape to node** — privileged container → `nsenter`/`/proc/1/root`, abusing
  `CAP_SYS_ADMIN`, hostPath mount of `/`, or the docker/containerd socket (see
  [`container-security.md`](container-security.md)).
- **Cloud pivot** — from a node, query IMDS for the kubelet managed-identity token and call
  Azure ARM (`T1078.004`, `T1552.007`).

These map to T1610/T1611/T1609/T1613 and feed attack-path narratives, but our automated
posture stays strictly read-only.

## 8. Cluster-active lane — gated live confirmation (`aks-container` Lane 2)

Everything in §7 stays knowledge-only in the **read-only posture lane**. The Azure Container &
Kubernetes Agent additionally owns a **hard-gated cluster-active lane** that confirms a narrow,
**benign, read-only** subset of the above against a *live, in-scope* cluster. It is **off by default**
and runs only under `engagement.yaml` → `mode: cluster-active-testing` with an enabled, authorized
`cluster_testing` block and a non-empty Azure-derived cluster allowlist — enforced fail-closed by the
cluster guardrail (mirrors the External Vulnerability Agent's egress lock).

The lane never mutates a workload: the guardrail denies every mutating `kubectl` verb
(`apply`/`create`/`delete`/`patch`/`edit`/`replace`/`scale`/`rollout`/`drain`/`cordon`/...) in **all**
modes, and only releases the active tools (`kube-bench`, `kubesec`, `trivy`, `grype`, ephemeral
`kubectl debug`) when the full gate passes. Three intensity tiers:

| Tier | Name | Confirms (knowledge §) | Tooling |
|---|---|---|---|
| C1 | `cluster-benchmark` | CIS node/RBAC/PSS controls (§3, §4, §6) | `kube-bench`, `kubesec`, `kubectl auth can-i --list` — API reads only |
| C2 | `image-scan` | Deep image CVEs beyond Defender (`container-security.md` §3) | **offline** `trivy`/`grype` on pulled ACR digests |
| C3 | `runtime-probe` | Reachable SA token / in-pod inventory (§3 token mounts) | benign read-only inventory via an **ephemeral debug container**, removed after use |

Map: `CHK-CNTR-KUBE-BENCH-CIS`, `CHK-CNTR-MANIFEST-RISK` (C1); `CHK-CNTR-IMAGE-CVE-DEEP` (C2);
`CHK-CNTR-SA-TOKEN-REACH`, `CHK-CNTR-RUNTIME-INVENTORY` (C3). The offensive escalation paths in §7
(privilege escalation, container escape, cloud pivot) remain **knowledge only** — the active lane
proves *exposure* with a benign marker and never attempts breakout or exfiltration. See
`agents/aks-container/system-prompt.md` and `knowledge/aks-security-baseline.md` §4.
