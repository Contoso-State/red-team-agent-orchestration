# Finding Template

> A single finding. The canonical structured form is `schemas/finding.schema.json`; this is the human-readable view. Agents emit JSONL to `findings/raw/<agent>.jsonl`.

```json
{
  "id": "AZ-STOR-001",
  "title": "Storage account permits anonymous blob access",
  "severity": "Critical",
  "confidence": "High",
  "agent": "data-protection",
  "category": "Storage",
  "check_id": "CHK-STOR-ANON-CONTAINER",
  "resource_id": "/subscriptions/<sub>/resourceGroups/<rg>/providers/Microsoft.Storage/storageAccounts/<name>",
  "subscription_id": "<sub>",
  "resource_group": "<rg>",
  "region": "eastus",
  "description": "Container 'backups' has public access level 'Blob', exposing all blobs to unauthenticated internet users.",
  "attack_vector": "Public exposure -> unauthenticated data download",
  "risk": "Sensitive backup data is downloadable by anyone with the URL or via storage enumeration.",
  "recommendation": "Set container access level to Private and disable allowBlobPublicAccess on the account.",
  "evidence": [
    {
      "source": "azure-storage container list",
      "summary": "Container 'backups' publicAccess = Blob",
      "raw_ref": "evidence/raw/stor-001.json"
    }
  ],
  "attack_path": [],
  "controls": {
    "cis_azure": ["3.7"],
    "mitre": ["T1530"]
  },
  "references": [
    "https://learn.microsoft.com/azure/storage/blobs/anonymous-read-access-configure"
  ],
  "status": "open",
  "first_seen": "2026-06-05T12:00:00Z"
}
```

## Field guidance

- **id**: `AZ-<DOMAIN>-<NNN>`. Domains: IDEN, AUTHZ, PATH, NET, COMP, STOR, KV, SQL, DATA, LOG.
- **severity**: propose using `knowledge/severity-model.md`; Reporting Agent finalizes.
- **confidence**: High for direct config reads; lower for inferred/correlated findings.
- **evidence**: never include secret values. Summarize, and point `raw_ref` to gitignored raw evidence.
- **attack_path**: populate only for correlated multi-step chains (`AZ-PATH-`).
- **controls**: always map to CIS and/or MITRE where applicable.
