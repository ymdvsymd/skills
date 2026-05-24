# worksample-question-generator eval

waza project-mode eval suite for the `worksample-question-generator` skill.

## PII safety policy

This task evaluates the skill against real recruitment artifacts. The committed
task YAML and README MUST NOT contain candidate names, company names, dated
personal directories, or any identifying information.

Convention:

- `tasks/<task>.yaml` — committed. Uses `${VAR}` placeholders for every path
  that would otherwise leak PII.
- `.env.local` — **gitignored**. Sets the concrete paths for local execution.
  Plain shell file (not YAML) so waza does not pick it up as a task.
- `.env.local.example` — committed template. Copy to `.env.local` and fill in.

Defense-in-depth: `.gitignore` blocks both `evals/*/.env.local` and
`evals/*/tasks/*.local.yaml`, so an accidental `git add evals/` cannot leak
either form.

## Running

```bash
cp evals/worksample-question-generator/.env.local.example \
   evals/worksample-question-generator/.env.local
# edit .env.local with concrete paths
source evals/worksample-question-generator/.env.local
waza run worksample-question-generator
```

Or set the env vars manually:

```bash
export WAZA_TASK_FILES="/path/to/worksample.pdf"
export WAZA_ANSWER_FILES="/path/to/answer.md, /path/to/wireframe.pdf"
```

## Env vars

Both vars accept one-or-more files as a single line, comma-separated
(`, ` between paths). The string is interpolated verbatim into the prompt.

- `WAZA_TASK_FILES` — worksample assignment file(s) (typically the PDF brief)
- `WAZA_ANSWER_FILES` — candidate's response file(s) (e.g. markdown + wireframe PDF)
