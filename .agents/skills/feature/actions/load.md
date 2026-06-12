# Load Action

Documentation only — update `current-feature.md`. Do not create a branch, modify source code, or run `start`.

1. **Check existing state** — Read `context/current-feature.md`. If Status is `In Progress`, warn:
   > "Active feature in progress: [name]. Overwrite with new spec?"
   Wait for confirmation before continuing.

2. **Resolve input** (`$ARGUMENTS` after "load"):
   - **Single word** — read `context/features/{name}.md`; if not found, try `context/fixes/{name}.md`; if neither exists, error: "Spec file not found at either path."
   - **Multiple words** — treat as inline description; research is required
   - **Empty** — error: "`load` requires a spec filename or description"

3. **Research** — goal is finding enough to write concrete, verifiable goals; not general orientation:
   - Grep for symbols/patterns from the spec; read 2–4 files the feature will likely touch
   - Extract: files to modify, utilities to reuse, schema/API contracts involved, rule constraints
   - For spec files: spec is primary; research fills gaps only
   - For inline input: research is mandatory — do not guess file paths

4. **Write goals** — each goal must be verifiable by reading the codebase (the `review` action will grep for them):
   - State as implementation facts: `<layer> uses <X> for <Y>`, `<file> is deleted`, `<function> does <Z>`
   - Avoid aspirational language ("performance improves") — state the code change that delivers it
   - Aim for 4–10 goals; each checkable in 1–2 file reads

5. **Write notes** as labeled sub-bullets:
   - **Files to touch:** file paths likely to change
   - **Utilities to reuse:** existing helpers, hooks, or actions that apply
   - **Out of scope:** what will not be done in this feature
   - **Constraints:** rate limits, schema restrictions, rule violations to avoid

6. **Update `context/current-feature.md`:**
   ```
   # Current Feature: <short name>

   ## Status
   Not Started

   ## Goals
   - <goal>

   ## Notes
   - **Files to touch:** ...
   - **Utilities to reuse:** ...
   - **Out of scope:** ...
   - **Constraints:** ...
   ```

7. **Confirm** — reply with: feature name, goal count, and the 2–3 most important files noted.
