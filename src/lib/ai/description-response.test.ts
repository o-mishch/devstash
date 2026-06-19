import { describe, it, expect } from 'vitest'
import {
  parseAiDescriptionResponse,
  buildDescriptionOutputRules,
  ITEM_DESCRIPTION_SYSTEM_PROMPT,
  COLLECTION_DESCRIPTION_SYSTEM_PROMPT,
  ITEM_MAX_DESCRIPTION_CHARS,
  COLLECTION_MAX_DESCRIPTION_CHARS,
} from './description-response'

describe('parseAiDescriptionResponse', () => {
  it('parses JSON object responses', () => {
    expect(parseAiDescriptionResponse('{"description":"A short summary."}', ITEM_MAX_DESCRIPTION_CHARS))
      .toBe('A short summary.')
  })

  it('parses plain string responses', () => {
    expect(parseAiDescriptionResponse('A plain summary.', ITEM_MAX_DESCRIPTION_CHARS))
      .toBe('A plain summary.')
  })

  it('rejects invalid JSON objects', () => {
    expect(parseAiDescriptionResponse('{ "notDescription": "nope" }', ITEM_MAX_DESCRIPTION_CHARS))
      .toBeNull()
  })

  it('rejects malformed JSON', () => {
    expect(parseAiDescriptionResponse('{ "description": ', ITEM_MAX_DESCRIPTION_CHARS))
      .toBeNull()
  })

  it('truncates descriptions that exceed the max length', () => {
    const long = 'a'.repeat(ITEM_MAX_DESCRIPTION_CHARS + 20)
    expect(parseAiDescriptionResponse(JSON.stringify({ description: long }), ITEM_MAX_DESCRIPTION_CHARS))
      .toBe('a'.repeat(ITEM_MAX_DESCRIPTION_CHARS))

    const withinCollectionLimit = 'a'.repeat(COLLECTION_MAX_DESCRIPTION_CHARS)
    expect(parseAiDescriptionResponse(JSON.stringify({ description: withinCollectionLimit }), COLLECTION_MAX_DESCRIPTION_CHARS))
      .toBe(withinCollectionLimit)
  })

  it('parses JSON wrapped in markdown code fences', () => {
    expect(
      parseAiDescriptionResponse(
        '```json\n{"description":"A fenced summary."}\n```',
        ITEM_MAX_DESCRIPTION_CHARS
      )
    ).toBe('A fenced summary.')
  })

  it('strips a non-json language fence around a plain-text description', () => {
    expect(
      parseAiDescriptionResponse('```text\nA fenced summary.\n```', ITEM_MAX_DESCRIPTION_CHARS)
    ).toBe('A fenced summary.')
  })
})

describe('buildDescriptionOutputRules', () => {
  it('uses the provided max character limit in the prompt', () => {
    expect(buildDescriptionOutputRules(ITEM_MAX_DESCRIPTION_CHARS)).toContain(`maximum ${ITEM_MAX_DESCRIPTION_CHARS} characters`)
    expect(buildDescriptionOutputRules(COLLECTION_MAX_DESCRIPTION_CHARS)).toContain(`maximum ${COLLECTION_MAX_DESCRIPTION_CHARS} characters`)
  })

  it('embeds context-specific limits in system prompts', () => {
    expect(ITEM_DESCRIPTION_SYSTEM_PROMPT).toContain(`maximum ${ITEM_MAX_DESCRIPTION_CHARS} characters`)
    expect(COLLECTION_DESCRIPTION_SYSTEM_PROMPT).toContain(`maximum ${COLLECTION_MAX_DESCRIPTION_CHARS} characters`)
  })
})
