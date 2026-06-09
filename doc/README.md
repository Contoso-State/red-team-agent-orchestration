# Documentation site

This folder is the source for the project documentation site, built with
[**mystmd**](https://mystmd.org) (the Jupyter Book v2 engine) using the MyST `book-theme`
— the same toolchain Microsoft's PyRIT docs use.

The site is published to **GitHub Pages** at
<https://contoso-state.github.io/red-team-agent-orchestration/> by the
[`docs` workflow](../.github/workflows/docs.yml) on every push to `main` that touches
`doc/**`.

## Build locally

```bash
npm install -g mystmd            # one-time
cd doc
myst start                       # live preview at http://localhost:3000
# or produce the deployable static site:
myst build --html
```

The static build is written to `doc/_build/html` (gitignored).

## Structure

- `myst.yml` — project config, theme, and the table of contents (`toc`).
- `*.md` — MyST Markdown content pages.
- `assets/` — images referenced by the pages.

To add a page, create the Markdown file and add it to the `toc` in `myst.yml`.
