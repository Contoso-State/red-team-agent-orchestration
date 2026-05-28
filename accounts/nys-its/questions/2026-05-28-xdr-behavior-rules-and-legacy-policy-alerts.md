# NYS ITS — XDR Behavior Rules & Legacy Policy Replacement

**Date:** 2026-05-28
**Source:** Forwarded from OSC session (Q&A originated in ITS-adjacent context, belongs in ITS account)
**Topic area:** Microsoft Defender XDR / Sentinel — behavior detections, alert generation, legacy policy migration

---

## Q1. Do the new behavior rules generate alerts? It looks like they don't.

**Answer:** **Yes, the new behavior rules do generate alerts.**

- The dynamic behavior detections work similarly to the legacy policies and produce comparable alerts.
- Alert **names/titles may differ slightly** from the legacy policies, which can make it look like nothing is firing if you're searching for the old titles.
- Behind the scenes, these rules leverage **User Behavior Analytics (UBA)** and will automatically alert you **without any additional configuration**.

**Validation steps for ITS:**
- Search the Defender XDR / Sentinel alerts blade by **detection source** = "Microsoft Defender for Identity" (or relevant product) rather than by the old policy title
- Check the **Alert tuning** page to confirm rules are enabled and not suppressed
- Review the **Advanced hunting** schema (`AlertInfo`, `AlertEvidence`) for the new detection names — they're typically prefixed with the UBA category

---

## Q2. If the new rules don't generate alerts, how do we replace the alerts we lost when Microsoft disabled the legacy policies? It doesn't make sense to require customers to manually create XDR behavior alerts for Microsoft-managed rules. The administrative overhead of identifying new behavior rules and manually creating alerts for each one is unreasonable. These rules should alert like every other security monitoring product.

**Answer:** **The premise is incorrect — the new behavior rules DO generate alerts automatically, just like the legacy policies did.**

- You should **not** need to manually create alerts for Microsoft-managed detections.
- Alerts are firing and will continue to fire **without any manual configuration**.
- If the ITS team is not seeing alerts they expected, the most likely causes are:
  1. **Alert names changed** — searching by old title misses the new alerts
  2. **Alert tuning / suppression rules** carried over from legacy policies may be silencing the new ones
  3. **Severity filter** in the alerts blade hiding lower-severity alerts the new rules generate
  4. **Detection source filter** scoped to the old product/source

**Optional (not required):** If ITS wants to **fine-tune detection logic** or **create their own custom detections**, that can be done through **XDR custom detection rules**. But this is **optional and intended for customization** — it is **not a replacement** for the built-in alerting.

---

## Recommended Follow-Up

1. **Live walkthrough with ITS SOC** — open the Defender XDR alerts blade together; filter by the new UBA detection source; confirm alerts are present
2. **Audit alert tuning / suppression rules** — verify nothing from the legacy policy era is suppressing the new behavior alerts
3. **Map legacy policy → new behavior rule** — produce a translation table so the SOC's runbooks reference current detection names
4. **Optional advanced hunting query** — provide a KQL query that lists all UBA-generated alerts in the last 30 days so ITS can validate volume
5. **Document the change** internally so the SOC stops expecting alerts by legacy names

---

## Open Questions Back to ITS

- Which specific legacy policies do they believe were disabled and are no longer generating alerts? (Need names to map to current detections)
- What's the source-of-truth they're using to identify "missing" alerts — Sentinel workspace, Defender XDR portal, or downstream SIEM?
- Are there any alert tuning rules / suppression rules in their tenant that pre-date the legacy → behavior migration?
- What's their current alert volume baseline? (To compare against post-migration to confirm coverage parity)
