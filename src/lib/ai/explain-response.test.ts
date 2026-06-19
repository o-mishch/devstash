import { describe, it, expect } from 'vitest'
import { parseAiExplanationResponse, CODE_EXPLANATION_SYSTEM_PROMPT } from './explain-response'
import { ITEM_DESCRIPTION_MAX_CHARS } from '@/lib/utils/validators'

describe('parseAiExplanationResponse', () => {
  it('parses plain Markdown responses (the expected shape)', () => {
    const md = 'Memoizes a fetch.\n\n- caches by key\n- dedupes in-flight calls'
    expect(parseAiExplanationResponse(md)).toBe(md)
  })

  it('parses JSON object responses', () => {
    expect(parseAiExplanationResponse('{"explanation":"It retries with backoff."}'))
      .toBe('It retries with backoff.')
  })

  it('rejects JSON objects missing the explanation key', () => {
    expect(parseAiExplanationResponse('{ "notExplanation": "nope" }')).toBeNull()
  })

  it('rejects malformed JSON', () => {
    expect(parseAiExplanationResponse('{ "explanation": ')).toBeNull()
  })

  it('rejects empty / whitespace-only responses', () => {
    expect(parseAiExplanationResponse('   ')).toBeNull()
    expect(parseAiExplanationResponse('{"explanation":"   "}')).toBeNull()
  })

  it('strips a wrapping markdown code fence', () => {
    expect(parseAiExplanationResponse('```markdown\nIt does X.\n```')).toBe('It does X.')
    expect(parseAiExplanationResponse('```json\n{"explanation":"Fenced."}\n```')).toBe('Fenced.')
  })

  it('truncates explanations that exceed the max length', () => {
    const long = 'a'.repeat(ITEM_DESCRIPTION_MAX_CHARS + 50)
    expect(parseAiExplanationResponse(long)).toBe('a'.repeat(ITEM_DESCRIPTION_MAX_CHARS))
  })
})

describe('CODE_EXPLANATION_SYSTEM_PROMPT', () => {
  it('embeds the character limit', () => {
    expect(CODE_EXPLANATION_SYSTEM_PROMPT).toContain(`${ITEM_DESCRIPTION_MAX_CHARS} characters`)
  })
})
