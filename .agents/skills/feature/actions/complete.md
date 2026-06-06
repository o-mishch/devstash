# Complete Action

1. Update and reset current-feature.md BEFORE committing:
   - Change H1 back to `# Current Feature`
   - Change Status back to `Not Started`
   - Clear Goals and Notes sections (keep placeholder comments)
2. Append a one-line feature summary to the END of `context/history.md` in this format:
   `- **Feature Name** - Brief description of what was built and key files changed (Completed)`
3. Stage all changes (including current-feature.md and history.md) and commit with a descriptive message
4. Switch to main and merge the feature branch (no push yet)
5. Push main to origin ONCE
6. Delete the local feature branch
7. If feature branch was previously pushed, delete it from origin