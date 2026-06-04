---
name: list-components
description: Lists React component files in src/components/ with one-line descriptions.
when_to_use: Use when asked to "list components", "show all components", "what components exist", "find components in [folder]", or get an overview of UI structure. Pass a subdirectory to narrow scope (e.g. /list-components dashboard).
argument-hint: [subdirectory]
allowed-tools: Glob, Read
---

## Task

List all React component files (.tsx, .ts, .jsx, .js) in `src/components/`.

If a subdirectory is provided via $ARGUMENTS, only list files in that subdirectory.

## Output Format

- Numbered list of files with relative paths
- Brief one-line description of each (infer from filename and content if needed)
- Summary count at the end

If no files found, say "No components found."
