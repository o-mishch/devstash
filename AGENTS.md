# DevStash — Agent Instructions

Rules live in `.agents/rules/` and are auto-discovered. Do not restate rule content here — edit the rule.

Activation is driven by each rule's own frontmatter:

- `trigger: always_on` (no `paths:`) — always applied. Deliberately only three, each binding on tasks that open no file: `boundary.md` (where new code goes), `security-principles.md` (IDOR/validation/tokens), `ai-interaction.md` (workflow, commit approval).
- `trigger: glob` + `globs:`/`paths:` — everything else, applied only when you touch matching files (Go, legacy Next.js, the Vite SPA, shared frontend, infra, project/item-type conventions).

Start with `boundary.md` for which workspace owns what, and `context/current-feature.md` for the current migration phase.

<!-- stripe-projects-cli managed:agents-md:start -->
## Stripe Projects CLI

This repository is initialized for the Stripe project "devstash".

## Tools used

- [Stripe CLI](https://docs.stripe.com/stripe-cli) with the `projects` plugin to manage third-party services, credentials, and deployments for this project. Use the stripe-projects-cli to manage deploying and access to third party services.
<!-- stripe-projects-cli managed:agents-md:end -->
