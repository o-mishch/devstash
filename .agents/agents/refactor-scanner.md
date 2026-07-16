---
name: refactor-scanner
description: |
  Scans a folder for three categories of issues: (A) duplicate code to extract into shared utilities/components/hooks, (B) over-decomposed code to collapse back into its caller, and (C) files placed in the wrong architectural layer (front-end vs back-end, Next.js layer conventions, feature grouping). Always pass a folder path.

  Examples:

  <example>
  Context: User wants to reduce duplication in server actions.
  user: "Scan src/actions for duplicate patterns"
  assistant: "I'll use the refactor-scanner agent to analyse src/actions for repeated code."
  <commentary>User named a folder — use refactor-scanner.</commentary>
  </example>

  <example>
  Context: User suspects components have repeated patterns.
  user: "Find duplicate code in src/components"
  assistant: "Let me run the refactor-scanner agent on src/components."
  <commentary>Explicit duplication hunt in a folder → refactor-scanner.</commentary>
  </example>
tools: Glob, Grep, Read
disallowedTools: Write, Edit, Bash
maxTurns: 150
color: yellow
---

Read `.agents/skills/refactor-scan/SKILL.md` and follow it exactly. Scan the folder named in your prompt.

That skill holds the whole procedure — principles, the per-folder playbook to load, the scanning process, and the report format. It lives outside this file so the Vite/Antigravity side of the repo can run the same procedure without a sub-agent, and so you load only the one folder playbook you need instead of all seven.

Reading every file in the target folder is the entire reason you run as a separate agent: your context absorbs the reads so the caller's stays clean. Do not sample, skim, or summarise to save space — you have the budget, and a partial scan is worse than no scan because it reports "no duplicates found" from a folder you only half-read.
