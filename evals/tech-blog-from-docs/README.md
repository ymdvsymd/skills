# tech-blog-from-docs eval

waza project-mode eval suite for the `tech-blog-from-docs` skill.

## Local-path policy

Task prompts reference a local APM documentation clone via `${APM_DOCS_DIR}`.
The path is developer-specific, so the committed task YAML uses a placeholder
and the concrete path is supplied through a gitignored env file.

Convention:

- `tasks/<task>.yaml` — committed. Uses `${APM_DOCS_DIR}` for the docs root.
- `.env.local` — **gitignored**. Sets the concrete path for local execution.
  Plain shell file (not YAML) so waza does not pick it up as a task.
- `.env.local.example` — committed template. Copy to `.env.local` and fill in.

Defense-in-depth: `.gitignore` blocks both `evals/*/.env.local` and
`evals/*/tasks/*.local.yaml`, so an accidental `git add evals/` cannot leak
either form.

## Running

```bash
cp evals/tech-blog-from-docs/.env.local.example \
   evals/tech-blog-from-docs/.env.local
# edit .env.local with the concrete APM docs path
source evals/tech-blog-from-docs/.env.local
waza run tech-blog-from-docs
```

Or set the env var manually:

```bash
export APM_DOCS_DIR="/path/to/apm/docs/src/content/docs"
```

## Env vars

- `APM_DOCS_DIR` — local clone of microsoft/apm's `docs/src/content/docs/`
  directory. Task prompts reference `${APM_DOCS_DIR}/concepts/` and
  `${APM_DOCS_DIR}/consumer/`.
