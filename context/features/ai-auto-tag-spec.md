# AI Auto-Tagging

## Overview

Add AI-powered tag suggestions for items using the OpenAI "gpt-4.1-nano" model. Users click a "Suggest Tags" button in the tags area, and the AI returns 3-5 freeform tag suggestions based on the item's title and content. Each suggestion has accept/reject controls. Pro-only feature with both UI-level and server-side gating. If this is the first AI feature implemented, it also establishes the OpenAI foundation (client, server action, rate limit config) for subsequent AI features.

## Requirements

- Create OpenAI client utility with `AI_MODEL` constant (if not already created by a prior AI feature)
- Use the standard openai SDK and keep it simple
- Create `generateAutoTags` server action with auth, Pro gating, Zod validation, rate limiting
- Add AI rate limit config (20 requests/hour per user) to existing rate limit utility (if not already added)
- Add "Suggest Tags" button (Sparkles icon, ghost variant) near the tags input in create item dialog and item drawer edit mode
- Display suggested tags as badges with accept (check) and reject (X) controls per tag
- Accepted tags get added to the item's tag list
- Tags are freeform (not limited to existing tags in the database)
- Keep the AI input within the 2000-char validation cap before the API call
- Hide the Suggest Tags button for free users (Pro-only UI gating)
- Error handling via toast (Pro gating, rate limit, AI service errors)
- Follow existing patterns
- Unit tests for server action

## OpenAI SDK & gpt-4.1-nano integration

Use the standard **Responses API**. `gpt-4.1-nano` is supported here and the current auto-tag flow reads from `output_text`.

```typescript
const response = await client.responses.create({
  model: 'gpt-4.1-nano',
  instructions: 'You are a developer tool assistant...',
  input: 'Suggest 3-5 tags for this snippet...',
});
const text = response.output_text;
```

### Gotchas

- Keep prompts compact and parse manually.
- The model may return `{"tags": ["a", "b"]}` OR `["a", "b"]` — handle both formats.
- Always normalize tags to lowercase after receiving them.

## Notes

- `OPENAI_API_KEY` already in `.env`
- `isPro` is available server-side via session but not passed to create/edit UI components — use server-side gating for enforcement, UI gating for button visibility requires passing `isPro` as a prop or fetching it client-side
- See `docs/ai-integration-plan.md` for full architectural context
