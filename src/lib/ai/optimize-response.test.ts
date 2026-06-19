import { describe, it, expect } from 'vitest'
import { parseAiOptimizedPromptResponse, PROMPT_OPTIMIZATION_SYSTEM_PROMPT } from './optimize-response'
import { OPTIMIZE_MAX_OUTPUT_CHARS } from '@/lib/utils/constants'

describe('parseAiOptimizedPromptResponse', () => {
  it('parses plain Markdown responses (the expected shape)', () => {
    const md = 'You are a senior engineer.\n\n- Do X\n- Then Y'
    expect(parseAiOptimizedPromptResponse(md)).toBe(md)
  })

  it('parses JSON object responses', () => {
    expect(parseAiOptimizedPromptResponse('{"prompt":"Act as a code reviewer."}'))
      .toBe('Act as a code reviewer.')
  })

  it('rejects JSON objects missing the prompt key', () => {
    expect(parseAiOptimizedPromptResponse('{ "notPrompt": "nope" }')).toBeNull()
  })

  it('rejects malformed JSON', () => {
    expect(parseAiOptimizedPromptResponse('{ "prompt": ')).toBeNull()
  })

  it('rejects empty / whitespace-only responses', () => {
    expect(parseAiOptimizedPromptResponse('   ')).toBeNull()
    expect(parseAiOptimizedPromptResponse('{"prompt":"   "}')).toBeNull()
  })

  it('strips a wrapping markdown code fence', () => {
    expect(parseAiOptimizedPromptResponse('```markdown\nDo the thing.\n```')).toBe('Do the thing.')
    expect(parseAiOptimizedPromptResponse('```json\n{"prompt":"Fenced."}\n```')).toBe('Fenced.')
  })

  it('truncates prompts that exceed the max length', () => {
    const long = 'a'.repeat(OPTIMIZE_MAX_OUTPUT_CHARS + 50)
    expect(parseAiOptimizedPromptResponse(long)).toBe('a'.repeat(OPTIMIZE_MAX_OUTPUT_CHARS))
  })
})

describe('PROMPT_OPTIMIZATION_SYSTEM_PROMPT', () => {
  it('embeds the character limit', () => {
    expect(PROMPT_OPTIMIZATION_SYSTEM_PROMPT).toContain(`${OPTIMIZE_MAX_OUTPUT_CHARS} characters`)
  })
})
