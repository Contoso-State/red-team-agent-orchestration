# Container, Image & Registry Security — Scanning, Trust, and Escape Detection

Reference knowledge for the Compute Platform Agent (`compute-platform`) when assessing
Azure Container Registry (ACR), container images, and the container runtime posture behind
AKS, Container Apps, and Container Instances. It covers the read-only hunts our checks
perform and the **active / manual** techniques that are *knowledge only*.

> **Attribution.** The methodology below was harvested from the Apache-2.0
> [`mukul975/Anthropic-Cybersecurity-Skills`](https://github.com/mukul975/Anthropic-Cybersecurity-Skills)
> project (author *mahipal*, pinned commit `04450304b12645cb2b974ab96d28c0664758a88d`) —
> specifically the `scanning-containers-with-trivy-in-cicd`,
> `securing-container-registry-images`, `detecting-container-escape-attempts`, and
> `hardening-docker-containers-for-production` skills. We re-expressed the *methodology*
> (read-only commands, detection logic, control mappings) in this repository's structures;
> we did not copy their `SKILL.md` or Python files. See
> [`../THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md) and
> [`ATTRIBUTION.md`](ATTRIBUTION.md).

---

## 1. Container supply-chain attack surface

| Stage | Exposure | Related checks |
|---|---|---|
| Registry access | Admin user, public network, anonymous pull | `CHK-COMP-ACR-ADMIN-USER`, `CHK-COMP-ACR-PUBLIC-ANON` |
| Image scanning | Defender for Containers / scan-on-push not enabled | `CHK-COMP-ACR-NO-DEFENDER-SCAN` |
| Image integrity | No content trust / quarantine / tag immutability | `CHK-COMP-ACR-NO-CONTENT-TRUST` |
| Deployed images | Known critical/high CVEs, mutable `:latest` tags | `CHK-COMP-CONTAINER-IMAGE-VULN` |
| Runtime | Privileged containers, public ingress | `CHK-COMP-CONTAINER-PRIVILEGED-INGRESS`, `CHK-COMP-AKS-NO-POD-SECURITY` |

## 2. MITRE ATT&CK techniques

| ID | Technique | Manifestation |
|---|---|---|
| T1195 | Supply Chain Compromise | Vulnerable/poisoned dependency or base image deployed |
| T1525 | Implant Internal Image | Malicious image pushed to ACR and later pulled |
| T1554 | Compromise Host Software Binary | Tampered/unsigned image substituted for a trusted one |
| T1610 | Deploy Container | Attacker runs a crafted image to gain execution |
| T1611 | Escape to Host | Container breaks isolation to reach the node |
| T1190 | Exploit Public-Facing Application | Exploitable CVE in a running container image |
| T1059.004 | Command and Scripting Interpreter: Unix Shell | In-container shell execution |

## 3. Image vulnerability scanning posture (read-only)

The goal is to confirm that images are **continuously** scanned and that critical/high
findings are acted on — not just at build time, because vulnerability databases change
daily.

- **Defender for Containers** — subscription plan `Containers` should be Standard tier;
  it provides registry vulnerability assessment and runtime scanning. Read-only:
  `az security pricing show -n Containers` and `az security assessment list` for
  registry/image findings (`CHK-COMP-ACR-NO-DEFENDER-SCAN`,
  `CHK-COMP-CONTAINER-IMAGE-VULN`).
- **Trivy** (Aqua, *optional accelerator*) — offline scanner for OS-package and
  application-dependency CVEs, Dockerfile misconfigurations, secrets, and SBOM generation.
  Used read-only against a **pulled image digest**:
  `trivy image --severity HIGH,CRITICAL <login-server>/<repo>@sha256:<digest>`. It is never
  required and never installed by a runner; it corroborates the Defender-based signal.
- **Grype/Syft** — complementary scanner / SBOM generator; same optional, read-only role.

Mutable tags (`:latest`) mask drift — a tag can be re-pushed to a different digest. Prefer
digest-pinned references; flag workloads that reference mutable tags.

## 4. Registry trust controls (ACR)

- **Content trust (image signing)** — `az acr config content-trust show` reports
  enabled/disabled per registry (Premium SKU). When disabled, unsigned or tampered images
  can be pulled with no integrity guarantee (`T1554`, `CHK-COMP-ACR-NO-CONTENT-TRUST`).
- **Quarantine** — when enabled, newly pushed images are held until they pass scanning,
  preventing vulnerable images from being pullable. Inspect the registry `policies`
  (`quarantinePolicy.status`).
- **Tag immutability** — locks a tag to a single digest so it cannot be silently
  overwritten; check `changeableAttributes` on repositories/manifests.
- **Admission enforcement** — on the cluster side, Notation/Cosign signature verification
  via Kyverno/Gatekeeper ensures only signed images run. (Documented for remediation; not a
  read-only Azure signal.)

Modern guidance: prefer **identity-based pull** (managed identity / `AcrPull`) over the
shared admin user, restrict the data plane to private endpoints, and disable anonymous
pull — see the existing `CHK-COMP-ACR-ADMIN-USER` / `CHK-COMP-ACR-PUBLIC-ANON` checks.

## 5. Container hardening baseline (CIS Docker / runtime)

Hardening principles (from `hardening-docker-containers-for-production`, CIS Docker
Benchmark) that our pod-security and image checks reinforce:

- Run as a non-root UID; set `runAsNonRoot: true` and a high `runAsUser`.
- `allowPrivilegeEscalation: false`; never `privileged: true`.
- Drop **ALL** Linux capabilities, add back only the minimum (e.g. `NET_BIND_SERVICE`).
- `readOnlyRootFilesystem: true`; mount writable paths as sized `emptyDir`.
- Seccomp `RuntimeDefault` (or a custom localhost profile); keep AppArmor enabled.
- No host namespaces (`hostNetwork`/`hostPID`/`hostIPC`), no `hostPath` mounts, no host
  ports; never mount the docker/containerd socket into a container.
- Pin images by digest; set resource requests/limits; disable
  `automountServiceAccountToken` when the API is not used.

## 6. Container escape — detection signals (knowledge / monitoring)

Container escape (`T1611`) breaks isolation to reach the host or other containers. These
are **detection** and **forensic** signals for the report and for blue-team correlation,
not runner actions:

- Privileged container or `CAP_SYS_ADMIN` performing namespace manipulation
  (`nsenter`, `unshare`, writes under `/proc/1/root`).
- Sensitive host mounts: `/`, `/etc`, `/var/run/docker.sock`, `/run/containerd`, host
  device files.
- Kernel-exploit patterns and anomalous syscall sequences.
- Unexpected egress from a pod to the cloud metadata endpoint (`169.254.169.254`) — pivot
  to the node managed identity (links to `CHK-COMP-AKS-NODE-MI-EXPOSURE`).

Runtime tools such as **Falco**, **Sysdig**, and **Tracee** detect these via
kernel/syscall monitoring; Defender for Containers provides managed runtime threat
detection on AKS. We surface *whether such monitoring exists* (logging/Defender coverage)
rather than performing runtime instrumentation.

## 7. Active / manual techniques — KNOWLEDGE ONLY

> ⚠️ The items below are **active/offensive** and exist only for situational awareness and
> attack-path narrative. They are **NOT** runner checks and must **NOT** be added to any
> `tools/az-cli` runner. They run only under explicit authorization, by a human.

- Pushing a backdoored or cryptominer image to a writable registry and waiting for it to be
  pulled (`T1525`).
- Exploiting a known CVE in a running image to gain a shell (`T1190`, `T1059.004`), then
  escaping to the node via a privileged context or mounted socket (`T1611`).
- Substituting an unsigned image for a trusted tag where content trust/immutability is off
  (`T1554`).

Our automated posture stays read-only: confirm scanning, trust, and patch controls exist
and are enforced; describe exploitation paths in the report.
