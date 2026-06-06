---
name: feature
description: Manages the full feature lifecycle from spec to merged PR.
when_to_use: Use when starting a feature (load spec, create branch), advancing work (review goals, run tests), explaining what changed, or completing a feature (commit, merge, clean up branch). Triggers on "start a new feature", "what am I working on", "review the feature", "complete the feature", "commit and merge".
argument-hint: load|start|review|test|explain|complete
disable-model-invocation: true
---

# Feature Workflow

Manages the full lifecycle of a feature from spec to merge.

## Current State

@context/current-feature.md

## Git Context

- Branch: !`git branch --show-current 2>/dev/null || echo "(not on a branch)"`
- Uncommitted changes: !`git status --short 2>/dev/null || echo "none"`

### File Structure

`context/current-feature.md` tracks only the active work:

- `# Current Feature` - H1 heading with feature name when active
- `## Status` - Not Started | In Progress | Complete
- `## Goals` - Bullet points of what success looks like
- `## Notes` - Additional context, constraints, or details from spec

Completed features are appended to `context/history.md` (never loaded at startup).

## Task

Execute the requested action: $ARGUMENTS

| Action     | Description                                               |
| ---------- | --------------------------------------------------------- |
| `load`     | Load a feature spec or inline description                 |
| `start`    | Begin implementation, create branch                       |
| `review`   | Check goals met, code quality                             |
| `test`     | Check for testable logic for server actions and utilities |
| `explain`  | Document what changed and why                             |
| `complete` | Commit, push, merge, reset                                |

See [actions/](actions/) for detailed instructions.

If no action provided, explain the available options.
