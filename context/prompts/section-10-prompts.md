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
