# NYS ITS — Questions Log

Track open questions, customer-asked questions, and follow-ups for NYS ITS.

## Format
Use one file per topic/meeting, or maintain a running log. Suggested naming: `YYYY-MM-DD-topic.md`

---

## Open Questions (Awaiting Customer Response)

| # | Date Asked | Question | Asked By | Status | Answer / Notes |
|---|------------|----------|----------|--------|----------------|
| 1 | | | | Open | |

## Questions From Customer (Need Our Response)

| # | Date Asked | Question | Owner | Due | Response |
|---|------------|----------|-------|-----|----------|
| 1 | 2026-05-26 | NYS ITS Central IT Azure Team has full admin to Azure Portal but no admin privilege in Entra ID. In AWS/GCP they have both. What Entra ID privileges do they need to create security groups, create service principals, add/remove users from groups, use PIM, etc.? | AG | 2026-05-26 | **Context:** Azure RBAC (Owner/Contributor on subscriptions) and Entra ID directory roles are two intentionally separate planes — Microsoft's design philosophy is least-privilege separation of duties between the cloud control plane (Azure) and the identity plane (Entra). This is by design, not a gap. **Recommended least-privilege Entra role mapping for an Azure platform team — see "Entra Roles for Azure Platform Team" deep-dive below.** Suggested next step: half-day workshop with NYS ITS Identity + Azure teams to model this against their current AWS/GCP separation and define a PIM-eligible role catalog. |

## Technical Deep-Dive Questions

_Architecture, integration, licensing, sizing, etc._

### Entra Roles for Azure Platform Team (NYS ITS)

**Background — why the planes are separate:**
- **Azure RBAC** governs what you can do *to Azure resources* (subscriptions, RGs, VMs, storage, etc.). Roles like Owner, Contributor, User Access Administrator scope to management groups / subscriptions / resource groups.
- **Entra ID directory roles** govern what you can do *to identities, apps, groups, and the tenant itself*. Owner on a subscription does not let you create app registrations or manage groups.
- This separation is by design — it lets identity admins delegate Azure resource ownership to platform teams without handing over the tenant. It's the same model behind AWS Organizations management account isolation from IAM Identity Center.

**Recommended Entra role mapping (least-privilege, PIM-eligible):**

| Task the Azure team needs to do | Recommended Entra Role | Notes |
|---|---|---|
| Create & manage app registrations (any app) | **Application Administrator** | Privileged role. Full app + service principal management, can manage app credentials. Grant via PIM. |
| Manage only apps they own (self-service pattern) | **Application Developer** | Non-privileged. Lets users create app registrations and become the owner. Combine with "Users can register applications = No" at tenant level and use this role for the platform team. |
| Same as Application Admin but without app proxy | **Cloud Application Administrator** | Privileged. Preferred when on-prem app proxy is not in scope. |
| Create / delete / manage security groups | **Groups Administrator** | Manage groups + group settings, assign group licenses. Does not include role-assignable groups (those require Privileged Role Admin). |
| Add/remove members from existing groups only | **Group owner** (per group) | Lowest-privilege option. Assign team members as owners of specific groups rather than a tenant-wide role. |
| Use PIM to elevate themselves into roles | **Eligible assignment** in PIM | No standing role; require approval/MFA/justification on activation. |
| Configure PIM settings for groups they own | **Groups Administrator** + group owner | For role-assignable groups: needs **Privileged Role Administrator** (much higher — restrict tightly). |
| Read directory (users, groups, apps, audit logs) | **Directory Readers** or **Global Reader** | Read-only baseline; pair with task-specific privileged roles via PIM. |
| Manage Conditional Access policies | **Conditional Access Administrator** | Privileged. Often kept with the central identity team, not the Azure platform team. |
| Manage user accounts (create, reset password, etc.) | **User Administrator** | Privileged. Usually identity team, not Azure platform team. |

**Recommended role bundle for "NYS ITS Azure Platform Engineer":**
- **Standing (always-on):** Directory Readers
- **PIM-eligible (just-in-time, MFA + justification + approval where appropriate):**
  - Application Administrator *or* Cloud Application Administrator
  - Groups Administrator
- **Avoid granting standing:** Global Administrator, Privileged Role Administrator, User Administrator, Conditional Access Administrator (those stay with the identity team).

**Tenant-level defaults to review with the identity team:**
- `Users can register applications` — recommend **No**, then grant Application Developer / Application Administrator via PIM to the platform team.
- `Users can create security groups` — recommend **No**, use Groups Administrator / group owner pattern.
- `Restrict access to Microsoft Entra admin center` — recommend **Yes** for non-admins.

**PIM enablement checklist:**
1. Confirm Entra ID **P2** licensing (or Microsoft Entra ID Governance) — required for PIM.
2. Onboard the chosen roles into PIM as **eligible** (not active) assignments.
3. Configure activation requirements: MFA, justification, ticket number, approver (for privileged roles).
4. Enable PIM for **Groups** for any role-assignable groups the platform team owns.
5. Enable access reviews (quarterly) for all PIM-eligible assignments.

**Authoritative references (verified via Microsoft Learn, 2026-05-26):**
- [Microsoft Entra built-in roles](https://learn.microsoft.com/entra/identity/role-based-access-control/permissions-reference) — full role catalog with permission deltas
- [Application Administrator role](https://learn.microsoft.com/entra/identity/role-based-access-control/permissions-reference#application-administrator)
- [Cloud Application Administrator role](https://learn.microsoft.com/entra/identity/role-based-access-control/permissions-reference#cloud-application-administrator)
- [Application Developer role](https://learn.microsoft.com/entra/identity/role-based-access-control/permissions-reference#application-developer)
- [Groups Administrator role](https://learn.microsoft.com/entra/identity/role-based-access-control/permissions-reference#groups-administrator)
- [Privileged Identity Management (PIM) for Groups](https://learn.microsoft.com/entra/id-governance/privileged-identity-management/groups-role-settings)
- [Who can add and register applications](https://learn.microsoft.com/entra/identity-platform/how-applications-are-added#who-has-permission-to-add-applications-to-my-azure-ad-instance)
- [Azure vs Entra ID roles (separation of duties)](https://learn.microsoft.com/entra/identity/role-based-access-control/azure-roles-vs-entra-id-roles)

## Business / Procurement Questions

_Budget, timeline, decision process, stakeholders, etc._

- Confirm Entra ID P2 / ID Governance licensing footprint to support PIM rollout.

## Resolved Questions

| Date Resolved | Question | Resolution |
|---------------|----------|------------|
| 2026-05-26 | What Entra roles does the Azure Platform Team need? | Recommend PIM-eligible bundle: Application Administrator + Groups Administrator + Directory Readers standing. Avoid Global Admin / User Admin / CA Admin (keep with identity team). See deep-dive above. |

