# MCP Server Configuration Guide

This document covers Model Context Protocol (MCP) server setup for Claude Code in this project, specifically Context7 for live library documentation.

## Overview

**MCP Servers** extend Claude Code with live access to external tools and data. This project uses:

- **Playwright** — Browser automation for testing and verification
- **Context7** — Live documentation fetching for libraries, frameworks, and APIs
- **Neon** — Database operations (project-level)
- **Vercel** — Deployment logs and project management (project-level)

## Context7 Setup

### What is Context7?

Context7 fetches up-to-date documentation, code examples, and API references for any library or framework. It's invaluable for checking:
- API syntax and configuration options
- Version-specific behavior and migration guides
- Library setup instructions and best practices
- Current benchmarks and performance metrics

### Installation

1. **Get an API key**
   - Go to https://context7.com/dashboard
   - Sign in or create a free account
   - Generate a new API key

2. **Update global MCP configuration**
   - Edit `~/.claude/mcp.json` (global Claude Code config)
   - Add or update the `context7` server entry:

   ```json
   {
     "mcpServers": {
       "context7": {
         "command": "npx",
         "args": [
           "-y",
           "@upstash/context7-mcp",
           "--api-key",
           "${CONTEXT7_API_KEY}"
         ],
         "env": {
           "CONTEXT7_API_KEY": "your-api-key-here"
         }
       }
     }
   }
   ```

3. **Enable in project**
   - Edit `.claude/settings.local.json`
   - Add `"context7"` to `enabledMcpjsonServers` array:

   ```json
   {
     "enabledMcpjsonServers": ["neon", "playwright", "vercel", "context7"]
   }
   ```

4. **Restart Claude Code**
   - Full quit (not just switch model)
   - Reopen Claude Code

### Usage

Once configured, use Context7 by asking about library docs:
- "How do I set up SSR in Next.js?"
- "What's the syntax for Prisma's raw SQL queries?"
- "Show me Stripe webhook examples"
- "How to configure Tailwind v4 with custom colors?"

Claude will automatically fetch current documentation instead of relying on training data.

## Troubleshooting

### Issue: "Monthly quota exceeded" error

**Symptoms:**
- Context7 tools return "Monthly quota exceeded" errors
- Curl requests to the API work fine with the same key
- Error persists after restarts

**Causes:**
1. API key has exhausted its quota
2. Environment variable not being passed to the MCP process
3. Claude Code argument parser misinterpreting special characters in the key

**Solutions:**

1. **Verify the API key works**
   ```bash
   curl -X GET "https://context7.com/api/v2/libs/search?libraryName=next.js&query=test" \
     -H "Authorization: Bearer YOUR_API_KEY"
   ```
   If this returns results, the key is valid.

2. **Use environment variable interpolation**
   - Never pass the API key directly as a CLI argument (special chars cause parsing issues)
   - Always use `"${CONTEXT7_API_KEY}"` in args with the key in `env` object
   - Claude Code's argument parser strips spaces and misinterprets hyphens; interpolation works around this

3. **Force a fresh MCP process**
   ```bash
   # Kill all Claude processes
   killall -9 Claude
   # Reopen Claude Code
   ```
   Claude caches MCP server processes; a hard kill + restart ensures the new config is loaded.

4. **Check for quota limits**
   - Log in to https://context7.com/dashboard
   - Check if the API key has a usage cap or quota tier
   - Create a new key if the current one is exhausted

### Issue: Context7 tools not appearing

- Verify `context7` is in `.claude/settings.local.json` `enabledMcpjsonServers`
- Check that `~/.claude/mcp.json` has the correct `context7` entry
- Restart Claude Code fully (not just model switch)
- Check Claude Code console for error messages

## Alternatives: Context7 Web Plugin

If local MCP configuration becomes problematic, use the official Context7 web plugin:

1. Go to https://claude.com/plugins/context7
2. Click "Install in Claude Code"
3. Complete OAuth authentication
4. Context7 tools are immediately available

**Advantages:**
- OAuth-based authentication (more secure)
- Works across claude.com/code and claude.com
- No local MCP configuration needed
- No quota/credential passing issues

**Setup locations:**
- `.claude/mcp.json` — Global MCP servers (all projects)
- `.claude/settings.local.json` — Project-level MCP permissions
- Web plugins → automatic, no config files needed

## Adding New MCP Servers

To add a new MCP server globally:

1. Add entry to `~/.claude/mcp.json` with correct command/args
2. Restart Claude Code
3. Enable in project's `.claude/settings.local.json` if needed

For remote MCP servers (HTTP-based):
```json
{
  "myserver": {
    "command": "npx",
    "args": ["-y", "mcp-remote", "https://example.com/mcp"]
  }
}
```

## References

- [Context7 Dashboard](https://context7.com/dashboard)
- [Upstash Context7 MCP](https://github.com/upstash/context7-mcp)
- [Claude Code MCP Documentation](https://claude.com/docs/mcp)
