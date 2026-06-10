# Third-Party Notices

This project incorporates material derived from third-party open-source projects.
The original works remain the property of their respective authors and are used in
accordance with their licenses. This file provides attribution as required by those
licenses.

---

## Anthropic-Cybersecurity-Skills

- **Project:** Anthropic-Cybersecurity-Skills
- **Source:** https://github.com/mukul975/Anthropic-Cybersecurity-Skills
- **Author:** mahipal (GitHub: [@mukul975](https://github.com/mukul975))
- **License:** Apache License 2.0
- **Pinned commit referenced:** `04450304b12645cb2b974ab96d28c0664758a88d`

### What we use

We **did not** copy that project's `SKILL.md` files or its Python `agent.py` scripts
into this repository. Instead, we **harvested security methodology** from a curated,
Azure-relevant subset of its 754 skill guides and re-expressed it in this repository's
native structures:

- Read-only `az` / Microsoft Graph / `kubectl get` commands adapted into our per-domain
  runners under `tools/az-cli/`.
- Detection logic and remediation guidance adapted into new entries in `checks/<domain>/checks.yaml`.
- The `nist_csf` and `mitre_attack` control mappings from their skill frontmatter,
  reflected in our `controls/nist-csf.yaml` and `controls/mitre-cloud.yaml`.
- Background technique knowledge consolidated into `knowledge/*.md`.

A per-skill map of exactly which upstream guide informed which of our artifacts is
maintained in [`knowledge/ATTRIBUTION.md`](knowledge/ATTRIBUTION.md).

### License terms

The Apache License 2.0 permits use, modification, and distribution of derivative works
provided that attribution and the license notice are retained. The full text of the
Apache License 2.0 is available at https://www.apache.org/licenses/LICENSE-2.0 and is
reproduced in that project's `LICENSE` file. This NOTICE file, together with
`knowledge/ATTRIBUTION.md`, constitutes our attribution for the harvested material.

> NOTE: This repository's own primary license (see `LICENSE`) continues to govern the
> original work authored here. The notice above applies specifically to the
> Apache-2.0-derived security methodology described in `knowledge/ATTRIBUTION.md`.
