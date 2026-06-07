## Playwright MCP Prompt

```text
Use the Playwright MCP to test
CRUD functionality. Log in with the user demo@devstash.io with the password 12345679. Click on the "New Item" button in the top bar and add a new snippet.
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
Use the user demo@devstash.io/12345678 to access protected areas


Create two feature spec files for Stripe integration - Phase 1 (core infrastructure) and Phase 2 (integration & UI). Use @docs/stripe-integration-plan. 
MD for reference. Phase 1 should include unit tests for the usage-limits module. Phase 2 covers webhooks, feature gating, and UI components that require Stripe CLI for testing.
save as:
context/features/stripe-phase-1-spec.md
context/features/stripe-phase-2-spec.md


we need a clear way to upgrade the user. Free isers should see a button in the header that says "Upgrade". Instead of that taking them directly to the Stripe checkout, create a / upgrade page that displays the features much like we have in the pricing area of the homepage. They should be able to select the PLN 20 monthly or PLN 270 yearly. Then they can click to upgrade from there to go through checkout

see src/lib/utils/constants.ts PRICING