# DevStash

Rules live in `.agents/rules/` and are **auto-discovered** — they are not imported here. Claude Code finds them through the `.claude/rules → ../.agents/rules` symlink; skills likewise via `.claude/skills`, and sub-agents via `.claude/agents`. Rules without `paths:` frontmatter load at launch; path-scoped ones load only when you read a matching file. Start with `boundary.md` for which workspace owns what.

## Current feature

@context/current-feature.md

<!--
MAINTAINER NOTES (stripped before Claude sees this file — free to keep here)

Do NOT "fix" anything by adding `@.agents/rules/*.md` imports. Claude Code @-imports don't
support globs and load each file IN FULL at launch — that would double-load the always-on
rules already picked up via the .claude/rules symlink AND force every path-scoped rule to
load every session, defeating the whole design. Per the official docs: "Splitting into
@path imports helps organization but doesn't reduce context, since imported files load at
launch." (https://code.claude.com/docs/en/memory.md)

Frontmatter is dual on purpose, one file serving two tools:
  - `paths:`            → Claude Code. Verified official; the ONLY field it scopes on.
  - `trigger:`/`globs:` → Antigravity. Inferred from the Windsurf/Cascade lineage
                          (same four mode names, same 12,000-char cap); Google documents
                          NO frontmatter syntax at all, so this is unverified but inert
                          if unread. Keep both keys in sync when editing globs.

Antigravity caps rule files at 12,000 chars each and truncates silently — check size before
growing one.

SUB-AGENTS are Claude-Code-only, unlike rules and skills. `.agents/agents/*.md` is Claude
Code's sub-agent format and reaches it via the `.claude/agents` symlink. Antigravity has no
equivalent: its custom sub-agents are runtime `define_subagent` tool calls, scoped to one
conversation, with no file format to check in. That asymmetry is why each sub-agent here is
a THIN SHIM whose body just points at a skill under `.agents/skills/` — the procedure lives
in the skill so both tools can run it, while the shim adds the isolation and tool limits
only Claude Code can enforce. Keep bulk material in the skill's `references/`, not in the
shim: a sub-agent loads only the reference it needs, and Antigravity gets the same skill.
Do NOT put non-sub-agent .md files under `.agents/agents/` — Claude Code scans that tree
recursively and treats every .md in it as a sub-agent definition.

WINDOWS: symlinks need Developer Mode or Administrator privileges. Without them git
materializes `.claude/rules` as a plain text file, the rules never resolve, and Claude Code
loads none of them. Enable Developer Mode, or replace the symlink with real file copies in
`.claude/rules/`. Mac/Linux need nothing extra. The same applies to `.claude/agents`.
-->

<!-- stripe-projects-cli managed:claude-md:start -->
look at AGENTS.md for your rules
<!-- stripe-projects-cli managed:claude-md:end -->
