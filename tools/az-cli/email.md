# Email Security — Az CLI / Graph Assessment Runner (Optional, M365)

Agent: `azure-redteam-email` · Checks: `checks/email/checks.yaml`

All commands read-only. Email security data comes from **DNS resolution** and **Microsoft Graph
(`az rest` GET)** / **Exchange Online PowerShell `Get-*` cmdlets**. Run only when M365 / Exchange
Online is in engagement scope and you hold the required Graph / Exchange read permissions.
**Never send mail, never modify policies or transport rules, never read message contents.**

## Enumerate accepted domains
```bash
az rest --method GET --url "https://graph.microsoft.com/v1.0/domains" \
  --query "value[].{domain:id,verified:isVerified}" -o json
```

## CHK-MAIL-SPF-MISSING-OR-WEAK — SPF posture (DNS, passive)
```bash
nslookup -type=TXT <domain>          # find v=spf1 ...; flag missing, +all, ?all, or multiple records
# or: dig +short TXT <domain>
```

## CHK-MAIL-DMARC-MISSING-OR-NONE — DMARC posture (DNS, passive)
```bash
nslookup -type=TXT _dmarc.<domain>   # flag missing, p=none, no rua=, or pct<100
# or: dig +short TXT _dmarc.<domain>
```

## CHK-MAIL-DKIM-NOT-ENABLED — DKIM posture (DNS / Exchange Online)
```bash
nslookup -type=CNAME selector1._domainkey.<domain>
nslookup -type=CNAME selector2._domainkey.<domain>
# Exchange Online (read-only) if module connected:
# Get-DkimSigningConfig | Format-List Domain,Enabled,KeySize
```

## CHK-MAIL-ANTIPHISH-WEAK — Anti-phishing / spoof intelligence
```powershell
# Exchange Online PowerShell (read-only):
Get-AntiPhishPolicy | Format-List Name,Enabled,EnableSpoofIntelligence,EnableMailboxIntelligence,EnableTargetedUserProtection
```

## CHK-MAIL-SAFE-LINKS-ATTACH-OFF — Safe Links / Safe Attachments
```powershell
Get-SafeLinksPolicy        | Format-List Name,IsEnabled,ScanUrls,DeliverMessageAfterScan
Get-SafeAttachmentPolicy   | Format-List Name,Enable,Action
```

## CHK-MAIL-RISKY-TRANSPORT-RULE — Mail-flow / transport rules
```powershell
Get-TransportRule | Where-Object { $_.SetSCL -eq -1 -or $_.RedirectMessageTo -or $_.BlindCopyTo } |
  Format-List Name,State,SetSCL,RedirectMessageTo,BlindCopyTo
```

## CHK-MAIL-OUTBOUND-FORWARD — External auto-forwarding
```powershell
Get-HostedOutboundSpamFilterPolicy | Format-List Name,AutoForwardingMode
```

> Where Exchange Online PowerShell is unavailable, equivalent posture can be read through Microsoft
> Graph security/policy GET endpoints — always `--method GET`, never a write verb.
