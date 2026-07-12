Get recommendations, best practices, and modern approaches from websearch, eventually from context7
Ask questions until you would have full context.


Allow, and add all commands for which you are asking for permissions to allowed-tools in:
.claude/settings.local.json
.agents/skills/cleanup 


Critically and very precisely review everything in the directory `backend`.
Make sure the project structure, design, patterns, and idioms strictly follow native Golang modern best practices.
the boilerplater covered with widely used libs in the Golang ecosystem.

Search for unnecessary complexity in any shape or layer.
KISS, DRY, SOLID


Do not copy/paste the nextjs native design.


@.agents/agents/refactor-scanner.md 
all `*.sh` scripts in directory `infra`

KISS, DRY, SOLID

Get recommendations, best practices, and modern approaches from websearch, eventually from context7
ask questions untill you would have full context.


1. Verify that GCP config fully satisfies and complies with recommendations, best practices, and modern approaches. All features present in the application utilize the existing GCP components.
2. Verify that the local run cluster is aligned with GCP, etc.
3. The Vercel deployment shouldn't be affected
4. Keep strict boundaries between Vercel and GCP/Local codebases:
- the existing codebase should be touched as little as possible, fewer invasions;
- the different branches of application should load of that dependecies/modules which used in this particular branch, not bom all dependencies.
1. @infra/gcp-run/run.sh covers everything that can be automated?
2. everything properly documented

Get recommendations, best practices, and modern approaches from websearch, eventually from context7. Ask if you need!
Before changing values in the existing config, read the comment before it and challenge the correctness of each config (decision). Double-check the correctness of each config (decision) and add an appropriate comment to avoid further drifting/touching the same config by other AI agents' attempts!




## Playwright MCP Prompt

```text
Use the Playwright MCP to test
CRUD functionality. Log in with the user demo@devstash.one with the password 12345679. Click on the "New Item" button in the top bar and add a new snippet.
Then proceed to edit the title of that snippet and update it.
Finally, delete the snippet.
```


/feature load Implement collection "create". We need a button in the top bar to create a new collection with a description.
We should follow the same patterns as items. Collections should be user-scoped, fetch from the server component via lib/db functions and api routes for any client-side calls
The create button should open a modal with the fields needed. Show a toast on success or failure. Make sure everything is updated with the new collection on save!

/feature load Add functionality to add an item to a single or multiple collections.
Add an input to the new/edit item forms to select the available collection to add the item to.
Don't worry about displaying the collection pages yet



/feature load create the /collections page and show the collections
Create the /collections/[id] page to show the items in that collection
Use the existing cards
Link the "View all collections" in the sidebar to /collections and link all collection cards to that specific collection page


/feature load Add buttons on /collections/lid] to edit, delete, and favorite. Do not implement favorites yet, just the icon/button. Add a modal for editing the metadata. Add a confirmation on delete. Items should NOT be deleted; they just will not exist in that collection anymore.
On the cards at/collections and dashboard, have the 3 dots icon show a dropdown with edit, delete, and favorite. Clicking anywhere else in the card will go to that collection page.


/feature load Create a settings page. Add a link for settings in the user icon dropdown at the bottom of the sidebar. The URL should be /settings and should be protected.
Move the Account actions, which include the delete account and forgot password, from the profile to the settings page!


Create a spec file at @context/features called homepage-spec.md to take the mockup in the @prototypes/homepage folder and create the actual app homepage from it. Here are some guidelines to add to the spec:
- Page broken up into server components and client components where needed for interactivity
- Use Tailwind/ShadCN like the rest of the project
- Keep code clean and dry.
- Make buttons and links go to the correct places
Look at the spec files in the @context/features folder for reference. Keep it concise but complete


run 
ui-reviewer.md
use Antigravity optimization (browser_subagent), etc.
Use the UI reviewer to check the website's user interface and provide feedback.
Check the homepage and the dashboard pages (items, collections), view item in drawl, create new item and collection, assign item to collection, add to favorite and pin item, favorit page, User profile page, user settings page, etc.
Use the user demo@devstash.one/12345678 to access protected areas


Create two feature spec files for Stripe integration - Phase 1 (core infrastructure) and Phase 2 (integration & UI). Use @docs/stripe-integration-plan. 
MD for reference. Phase 1 should include unit tests for the usage-limits module. Phase 2 covers webhooks, feature gating, and UI components that require Stripe CLI for testing.
save as:
context/features/stripe-phase-1-spec.md
context/features/stripe-phase-2-spec.md


we need a clear way to upgrade the user. Free isers should see a button in the header that says "Upgrade". Instead of that taking them directly to the Stripe checkout, create a / upgrade page that displays the features much like we have in the pricing area of the homepage. They should be able to select the PLN 20 monthly or PLN 270 yearly. Then they can click to upgrade from there to go through checkout

see src/lib/utils/constants.ts PRICING



Review @.agents/rules/ai-interaction.md from the point of view of an agent (you), 
in case something (or even majorly) you would change to make it more convenient for you to use that rule, please improve.
you can research in context7, or ask any question


Review all rulles in .agents/rules/* from the point of view of an agent (you), 
in case something (or even majorly) you would change to make it more convenient for you to use that rule, please improve.

then properly link rulles in @CLAUDE.md  and @AGENTS.md 
evaluate is it possible to use pattern like  .agents/rules/* ?

reaseach (context7) how rulles handles by claude code and by antigravity ide, to properly write and congigure the rulles.
you can ask any question


One more time, research recommendations and best practices of using the Route Handlers + zod-openapi + openapi-fetch.
In context7 and webseach.
map with the existing codebase.
The goal is to implement the solution 100% complient with recommendations and best practices 



write short enough consolidated prompt for ai agent

get recomendations and best practices from context7 and adjust @context/current-feature.md accordinly 


/feature load Implement prompt optimization for the prompt types. It should look at the current prompt and refine it if needed, then ask the user if they want to use that updated prompt. Put the "Optimize" button in the header, much like the "Explain" button in the snippets and command header