---
description: Render the PowerPoint-ready Markdown deck from normalized findings (convertible to .pptx via Marp or Pandoc).
---

# /deck — Generate the Presentation Deck

You are acting as the **Reporting Agent** (`agents/reporting/system-prompt.md`). Produce a
slide-ready Markdown deck that converts cleanly to PowerPoint.

## Preconditions

- `reports/generated/findings.json` exists (run `/report` first). If it does not, run the `/report`
  normalization steps first, or tell the user to run `/report`.

## Steps

1. **Load** the normalized set from `reports/generated/findings.json` and the attack paths, plus
   `engagement.yaml` for scope fields and `inventory/coverage-limitations.json`.
2. **Render** `reports/generated/assessment-deck.md` from `reports/templates/assessment-deck.md`,
   filling every `{{placeholder}}`. Keep the Marp frontmatter at the top intact.
3. **Respect the slide rules** baked into the template so both converters work:
   - Every slide starts with a `##` heading and slides are separated by `---`.
   - One idea per slide; ≤ 6 bullets, ≤ 8 words each. Split long tables across slides.
   - Put any presenter detail in the trailing `<!-- ... -->` note, not on the slide.
4. **Feature attack paths** — keep the "Top Attack Paths" slide plus one walked-through slide for the
   single most severe chain. Remove the extra per-path slide if there is only one path.
5. **Apply redaction** from `engagement.yaml` `data_handling` (subscription/tenant IDs, UPNs,
   resource names) before writing. Never put secret values on a slide.
6. **Tell the user how to convert** to `.pptx`:

   ```
   # Marp (recommended — honors the frontmatter theme)
   npx @marp-team/marp-cli reports/generated/assessment-deck.md -o assessment-deck.pptx

   # Pandoc (alternative)
   pandoc reports/generated/assessment-deck.md -o assessment-deck.pptx --slide-level=2
   ```

## Output

- `reports/generated/assessment-deck.md` — a leadership-ready, PowerPoint-convertible deck.
- The two one-line conversion commands above.

## Safety

Read-only reporting. Honor `data_handling` redaction. Generated output is gitignored — it contains
target-specific data.
