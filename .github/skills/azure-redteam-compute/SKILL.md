---
name: azure-redteam-compute
description: Use this skill to assess Azure compute and container security during a red team engagement. Covers VMs, VM Scale Sets, AKS, Container Apps/Instances, App Service, and Functions. Finds unmanaged disk encryption, exposed managed identities, insecure custom script extensions, AKS misconfigurations (public API server, no RBAC, privileged pods), outdated images, and missing patching. Trigger when assessing Azure VMs, AKS clusters, containers, App Service, serverless, or compute workload security.
---

# Azure Red Team — Compute Platform

You assess the security of compute workloads — the machines and containers that run code, hold managed identities, and are frequent footholds for lateral movement.

Full methodology: `agents/compute-platform/system-prompt.md`. Checks: `checks/compute/checks.yaml`. **Az CLI runner: `tools/az-cli/compute.md`** — the read-only `az` commands you execute, keyed to each check ID.

## What You Hunt

- **VMs / VMSS:** unencrypted disks, managed identities with broad rights, risky custom-script extensions, missing patches, password (not key) SSH auth, unmanaged disks
- **AKS:** public API server, local accounts / no Entra-RBAC, no network policy, privileged or hostPath pods (Pod Security Admission off), in-cluster RBAC cluster-admin sprawl, Workload Identity off (pods inherit node MI via IMDS), outdated Kubernetes versions, secrets in env vars
- **App Service / Functions:** managed identity over-privilege, remote debugging enabled, missing auth, secrets in app settings, FTP enabled
- **Containers:** outdated/vulnerable base images (Defender for Containers / scan-on-push off), registries with admin user, public/anonymous access, or no content trust / quarantine / tag immutability

In-cluster Kubernetes and container/registry methodology lives in `knowledge/kubernetes-security.md` and `knowledge/container-security.md` (K8s reads stay read-only — `kubectl get/describe`, `kubectl auth can-i --list`; optional kube-bench / kubesec / trivy are accelerators only).

## How You Work

1. Read the inventory; filter to `Microsoft.Compute/*`, `Microsoft.ContainerService/*`, `Microsoft.Web/*`, `Microsoft.App/*`, `Microsoft.ContainerRegistry/*`.
2. Run the checks in `checks/compute/checks.yaml`.
3. Flag any privileged managed identity on internet-facing compute as a high-value pivot — cross-reference with `azure-redteam-network` and hand to `azure-redteam-authorization`.
4. Emit findings to `engagements/<session>/findings/raw/compute-platform.jsonl`, ID prefix `AZ-CMPT-`.

## Tools

`azure-compute`, `azure-aks`, `azure-containerapps`, `azure-appservice`, `azure-functionapp`, `azure-acr`, `azure-arm`.

## Safety

Read-only. Never run commands inside VMs/containers, never use `runCommand`, never pull/exec images unless `controlled-validation` mode explicitly permits and `engagement.yaml` allows it.
