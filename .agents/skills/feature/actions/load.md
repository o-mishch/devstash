# Load Action

Documentation only — update `current-feature.md`. Do not create a branch, modify source code, or run `start`.

1. Resolve input ($ARGUMENTS after "load"):
   - **Spec file** (single word, no spaces): read `context/features/{name}.md` or `context/fixes/{name}.md`
   - **Inline** (multiple words): treat as the feature description
   - **Empty**: error — "load" requires a spec filename or feature description

2. Research enough to make goals concrete:
   - Find similar features or patterns in the codebase (grep, read 2–4 relevant files)
   - Note likely files to touch, existing utilities to reuse, and constraints from `.agents/rules/`
   - For spec files: use the spec as primary source; research fills gaps only
   - For inline input: research is required — do not guess file paths or patterns

3. Update `context/current-feature.md`:
   - H1: `# Current Feature: <short name>`
   - `## Status` → `Not Started`
   - `## Goals` → bullet points of what success looks like (testable, user-visible outcomes)
   - `## Notes` → file paths, patterns to follow, models/APIs, rate limits, out-of-scope items

4. Confirm with a short summary: feature name, goal count, and key files noted
