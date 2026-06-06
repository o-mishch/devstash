---
name: research
description: Runs a named research task from context/research/<name>.md and writes findings to a doc file.
when_to_use: Only invoked explicitly as /research <name> where a matching prompt file exists at context/research/<name>.md. Never auto-triggered by Claude — the research file name must come from the user.
argument-hint: <prompt-name>
disable-model-invocation: true
allowed-tools: Glob, Grep, Read, Write, Bash, mcp__neon__run_sql, mcp__neon__get_database_tables, mcp__neon__describe_table_schema
---

## Task

Execute research task: $ARGUMENTS

---

### Instructions

1. If no argument provided, error: "Usage: /research <prompt-name>"
2. Look for prompt file at `context/research/{$ARGUMENTS}.md`
3. If not found, error: "Prompt file not found at context/research/{$ARGUMENTS}.md"
4. Read the prompt file which should contain:
   - **Output**: Where to write results (e.g., `context/content-types.md`)
   - **Research**: What to investigate
   - **Include**: Specific details to capture
   - **Sources**: What files/tools to use
5. Execute the research using appropriate tools:
   - Read files (Prisma schema, constants, components)
   - Query database via Neon MCP if needed
   - Search codebase for patterns
6. Write findings to the specified output location
7. Summarize what was discovered

---

### Rules

- This command produces DOCUMENTATION only
- Do NOT modify source code files
- Do NOT create branches or commits
- Output should go to `context/` unless otherwise specified in the prompt file
- Use subagents for thorough exploration if needed
