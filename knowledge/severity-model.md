# Severity Model

How the red team assigns and normalizes severity. Domain agents **propose** severity; the Reporting Agent applies this model to set the **final** severity consistently across the engagement.

## Severity levels

| Level | Meaning |
|---|---|
| **Critical** | Direct path to compromise of data, identity, or infrastructure. Internet-exploitable or trivial escalation to high privilege. Fix immediately. |
| **High** | Serious weakness that is a strong step in an attack chain or exposes sensitive resources with low effort. Fix urgently. |
| **Medium** | Meaningful weakness requiring additional conditions or existing access to exploit. Fix in normal cycle. |
| **Low** | Minor hardening gap or defense-in-depth improvement. Limited standalone impact. |
| **Informational** | Observation or hygiene note; no direct exploit. |

## Scoring factors

Severity is a function of five factors. Exposure and exploitability dominate.

| Factor | Weight | Question |
|---|---|---|
| **Exploitability** | High | How easy is it to exploit? (trivial / needs conditions / theoretical) |
| **Exposure** | High | Is the resource internet-facing or broadly reachable? |
| **Blast radius** | Medium | What's the scope of impact? (single resource / RG / subscription / tenant) |
| **Data sensitivity** | Medium | Does it affect sensitive data, credentials, or privileged identity? |
| **Compensating controls** | Low (reduces) | Are there mitigations (WAF, PIM, monitoring) in place? |

## Decision guide

```
Internet-exposed + unauthenticated + sensitive data/identity  => Critical
Internet-exposed + low-effort exploit                         => High
Escalation primitive held by non-owner                        => High (Critical if -> Owner/GA)
Sensitive resource reachable only with existing access        => Medium
Missing defense-in-depth control                              => Low/Medium
Hygiene / observation                                         => Informational
```

## Attack chains

A correlated attack path (`AZ-PATH-`) is scored by its **end state**, not its weakest step. A chain ending in subscription Owner or data exfiltration is Critical even if each individual step is only Medium. Chains are featured prominently in reports.

## Confidence interaction

- Confidence is independent of severity but constrains it.
- A finding with **Low confidence** must not be rated above **High** without corroborating evidence.
- Configuration-derived findings (read directly from Azure APIs) are typically **High** confidence.
- Inferred or correlated findings should state their confidence explicitly.

## Normalization rules (Reporting Agent)

1. When agents disagree on a duplicate, start from the higher proposed severity, then apply this model.
2. Reduce severity one level if strong compensating controls exist (e.g. exposed endpoint but WAF in Prevention mode + full monitoring).
3. Increase priority (not severity) for findings that are both exploitable **and** undetectable (no logging coverage).
4. Sanity-check the distribution: if everything lands Critical or nothing does, re-examine.
