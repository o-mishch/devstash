import { vi, describe, it, expect } from 'vitest'
import type OpenAI from 'openai'
import type { Logger } from 'pino'
import {
  parseBrainDumpLine,
  consumeBrainDumpStream,
  buildFailureDetail,
  type BrainDumpDraft,
  type BrainDumpStreamHandlers,
} from './brain-dump'

type ResponseEvent = OpenAI.Responses.ResponseStreamEvent

describe('parseBrainDumpLine', () => {
  it('skips empty, whitespace, and non-JSON stream artifacts', () => {
    expect(parseBrainDumpLine('')).toBeNull()
    expect(parseBrainDumpLine('   \n')).toBeNull()
    expect(parseBrainDumpLine('```json')).toBeNull()
    expect(parseBrainDumpLine('some text delta')).toBeNull()
  })

  it('coerces missing or unknown itemTypeName to "note" (lose nothing)', () => {
    // Missing type
    const res1 = parseBrainDumpLine(JSON.stringify({ title: 'A', content: 'C' }))
    expect(res1?.itemTypeName).toBe('note')
    expect(res1?.content).toBe('C')

    // Invalid type
    const res2 = parseBrainDumpLine(JSON.stringify({ itemTypeName: 'invalid_type', title: 'A', content: 'C' }))
    expect(res2?.itemTypeName).toBe('note')
  })

  it('demotes link item with no url to note', () => {
    const res = parseBrainDumpLine(JSON.stringify({ itemTypeName: 'link', title: 'A', content: 'C' }))
    expect(res?.itemTypeName).toBe('note')
    expect(res?.content).toBe('C')
    expect(res?.url).toBeNull()
  })

  it('titles a link from its url when the model gives no title (not from the discarded content)', () => {
    const res = parseBrainDumpLine(JSON.stringify({ itemTypeName: 'link', url: 'https://a.com/x', content: 'discard me' }))
    expect(res?.itemTypeName).toBe('link')
    expect(res?.url).toBe('https://a.com/x')
    // A link's content is cleared, so its fallback title must derive from the url — never the prose that's
    // about to be discarded.
    expect(res?.title).not.toBe('discard me')
    expect(res?.title).toContain('a.com')
  })

  it('clears content/language for links, and url for snippets/prompts/notes', () => {
    // link retains url, drops content/language
    const resLink = parseBrainDumpLine(
      JSON.stringify({ itemTypeName: 'link', title: 'L', url: 'https://a.com', content: 'c', language: 'js' }),
    )
    expect(resLink?.url).toBe('https://a.com')
    expect(resLink?.content).toBeNull()
    expect(resLink?.language).toBeNull()

    // snippet retains content/language, drops url
    const resSnip = parseBrainDumpLine(
      JSON.stringify({ itemTypeName: 'snippet', title: 'S', content: 'code', language: 'ts', url: 'http://a.com' }),
    )
    expect(resSnip?.content).toBe('code')
    expect(resSnip?.language).toBe('ts')
    expect(resSnip?.url).toBeNull()
  })

  it('synthesizes title from content when missing', () => {
    const res = parseBrainDumpLine(JSON.stringify({ itemTypeName: 'note', content: 'My first line\nSecond line' }))
    expect(res?.title).toBe('My first line')
  })

  it('clumps and limits tags to 5 lowercase alphanumeric tags', () => {
    const res = parseBrainDumpLine(
      JSON.stringify({ title: 'A', tags: ['React', 'HOOKS', '  ', 'react', 'a', 'b', 'c', 'd'] }),
    )
    expect(res?.tags).toEqual(['react', 'hooks', 'a', 'b', 'c'])
  })

  it('skips a line with no title and no content/url (truly empty)', () => {
    expect(parseBrainDumpLine(JSON.stringify({ tags: ['empty'] }))).toBeNull()
  })

  describe('language disambiguator (snippet ↔ command boundary)', () => {
    it('reclassifies a snippet carrying a shell language to command', () => {
      const res = parseBrainDumpLine(
        JSON.stringify({ itemTypeName: 'snippet', title: 'install', content: 'npm i', language: 'bash' }),
      )
      expect(res?.itemTypeName).toBe('command')
      expect(res?.language).toBe('bash')
      expect(res?.content).toBe('npm i')
    })

    it('reclassifies a command carrying a non-shell programming language to snippet', () => {
      const res = parseBrainDumpLine(
        JSON.stringify({ itemTypeName: 'command', title: 'fn', content: 'print(1)', language: 'python' }),
      )
      expect(res?.itemTypeName).toBe('snippet')
      expect(res?.language).toBe('python')
    })

    it('matches the language set case-insensitively', () => {
      const res = parseBrainDumpLine(
        JSON.stringify({ itemTypeName: 'snippet', title: 'sh', content: 'ls', language: 'ZSH' }),
      )
      expect(res?.itemTypeName).toBe('command')
    })

    it('leaves a correctly-typed snippet and command unchanged', () => {
      const snip = parseBrainDumpLine(
        JSON.stringify({ itemTypeName: 'snippet', title: 'ts', content: 'const x = 1', language: 'typescript' }),
      )
      expect(snip?.itemTypeName).toBe('snippet')
      const cmd = parseBrainDumpLine(
        JSON.stringify({ itemTypeName: 'command', title: 'ls', content: 'ls -la', language: 'sh' }),
      )
      expect(cmd?.itemTypeName).toBe('command')
    })

    it('does not reclassify when language is absent (no disambiguator to apply)', () => {
      const snip = parseBrainDumpLine(JSON.stringify({ itemTypeName: 'snippet', title: 'x', content: 'code' }))
      expect(snip?.itemTypeName).toBe('snippet')
      const cmd = parseBrainDumpLine(JSON.stringify({ itemTypeName: 'command', title: 'y', content: 'ls' }))
      expect(cmd?.itemTypeName).toBe('command')
    })

    it('never flips prompt/note/link even when a shell language is present', () => {
      const note = parseBrainDumpLine(
        JSON.stringify({ itemTypeName: 'note', title: 'n', content: 'about bash', language: 'bash' }),
      )
      expect(note?.itemTypeName).toBe('note')
      // language is dropped for non-language types regardless
      expect(note?.language).toBeNull()
    })
  })
})

describe('consumeBrainDumpStream', () => {
  const fakeLog = {
    info: vi.fn<Logger['info']>(),
    warn: vi.fn<Logger['warn']>(),
    error: vi.fn<Logger['error']>(),
  } as never

  function created(id: string): ResponseEvent {
    return { type: 'response.created', response: { id } } as ResponseEvent
  }
  function delta(text: string, seq: number): ResponseEvent {
    return { type: 'response.output_text.delta', delta: text, sequence_number: seq } as ResponseEvent
  }
  function completed(seq: number): ResponseEvent {
    return { type: 'response.completed', sequence_number: seq } as ResponseEvent
  }
  function incomplete(seq: number, reason?: 'max_output_tokens' | 'content_filter'): ResponseEvent {
    return {
      type: 'response.incomplete',
      sequence_number: seq,
      ...(reason ? { response: { incomplete_details: { reason } } } : {}),
    } as ResponseEvent
  }
  function failed(seq: number, message?: string): ResponseEvent {
    return { type: 'response.failed', sequence_number: seq, response: { error: { message } } } as ResponseEvent
  }

  function line(fields: Partial<BrainDumpDraft>): string {
    return JSON.stringify({ itemTypeName: 'note', ...fields })
  }

  async function* eventStream(events: ResponseEvent[]): AsyncIterable<ResponseEvent> {
    await Promise.resolve()
    for (const e of events) {
      yield e
    }
  }

  it('captures responseId on response.created', async () => {
    const onResponseId = vi.fn<BrainDumpStreamHandlers['onResponseId']>()
    await consumeBrainDumpStream(
      eventStream([created('resp_123')]),
      { startOrder: 0, onResponseId, onFlush: async () => {} },
      fakeLog,
    )
    expect(onResponseId).toHaveBeenCalledWith('resp_123')
  })

  it('buffers and flushes complete JSONL lines at clean boundaries, advancing startOrder', async () => {
    const flushes: { drafts: BrainDumpDraft[]; startOrder: number; cursor: number | null }[] = []
    const a = line({ title: 'Item A' })
    const b = line({ title: 'Item B' })

    const result = await consumeBrainDumpStream(
      eventStream([
        created('resp_1'),
        delta(`${a}\n`, 1), // clean boundary (buffer empty)
        delta(b.slice(0, 10), 2), // split line part 1
        delta(`${b.slice(10)}\n`, 3), // split line part 2 -> clean boundary
      ]),
      {
        startOrder: 5,
        onResponseId: async () => {},
        onFlush: (drafts, startOrder, cursor) => {
          flushes.push({ drafts, startOrder, cursor })
          return Promise.resolve()
        },
      },
      fakeLog,
    )

    expect(flushes).toEqual([
      { drafts: [expect.objectContaining({ title: 'Item A' })], startOrder: 5, cursor: 1 },
      { drafts: [expect.objectContaining({ title: 'Item B' })], startOrder: 6, cursor: 3 },
    ])
    expect(result).toEqual({ status: 'detached', emitted: 2 })
  })

  it('drops un-boundaried pending drafts on non-terminal detach, replaying on resume', async () => {
    const flushes: BrainDumpDraft[][] = []
    const a = line({ title: 'A' })
    const b = line({ title: 'B' })

    const result = await consumeBrainDumpStream(
      // The stream ends (detached) while the buffer has a complete line + a partial tail that never reaches a newline
      eventStream([created('resp_1'), delta(`${a}\n`, 1), delta(b, 2)]),
      {
        startOrder: 0,
        onResponseId: async () => {},
        onFlush: (drafts) => {
          flushes.push(drafts)
          return Promise.resolve()
        },
      },
      fakeLog,
    )

    // Only A reached a clean boundary (buffer empty) and was flushed. B remains in the buffer and is
    // dropped.
    expect(flushes).toEqual([[expect.objectContaining({ title: 'A' })]])
    expect(result.status).toBe('detached')
  })

  it('flushes trailing buffer on terminal complete (no resume cursor needed)', async () => {
    const flushes: { drafts: BrainDumpDraft[]; cursor: number | null }[] = []
    const a = line({ title: 'A' })
    const b = line({ title: 'B' })

    const result = await consumeBrainDumpStream(
      // Stream ends with a complete line B, then completed event (cleans up any trailing text)
      eventStream([
        created('resp_1'),
        delta(`${a}\n`, 1), // flushed with cursor 1
        delta(b, 2), // in buffer
        completed(3), // terminal event
      ]),
      {
        startOrder: 0,
        onResponseId: async () => {},
        onFlush: (drafts, startOrder, cursor) => {
          flushes.push({ drafts, cursor })
          return Promise.resolve()
        },
      },
      fakeLog,
    )

    expect(flushes).toEqual([
      { drafts: [expect.objectContaining({ title: 'A' })], cursor: 1 },
      { drafts: [expect.objectContaining({ title: 'B' })], cursor: null }, // trailing flush uses cursor null
    ])
    expect(result.status).toBe('completed')
  })

  it('surfaces incomplete status on max_output_tokens cut, flushing tail', async () => {
    const items: BrainDumpDraft[] = []
    const a = line({ title: 'A' })
    const b = line({ title: 'B' })

    const result = await consumeBrainDumpStream(
      eventStream([
        created('resp_1'),
        delta(`${a}\n`, 1), // clean boundary
        delta(b, 2), // tail held in the buffer
        incomplete(3), // hit max_output_tokens — terminal but the run was cut short
      ]),
      {
        startOrder: 0,
        onResponseId: async () => {},
        onFlush: (drafts) => {
          items.push(...drafts)
          return Promise.resolve()
        },
      },
      fakeLog,
    )

    // Surfaced as `incomplete` so the caller can disclose the cut (never reported as a clean finish).
    // The buffered tail is still flushed on a terminal run (B is a complete line here; a real token-cut
    // tail would be a partial line that parseBrainDumpLine drops).
    expect(result.status).toBe('incomplete')
    expect(items.map((i) => i.title)).toEqual(['A', 'B'])
  })

  it('maps incomplete/max_output_tokens explicitly to incomplete (token-capped partial)', async () => {
    const result = await consumeBrainDumpStream(
      eventStream([created('r'), delta(`${line({ title: 'A' })}\n`, 1), incomplete(2, 'max_output_tokens')]),
      { startOrder: 0, onResponseId: async () => {}, onFlush: async () => {} },
      fakeLog,
    )
    expect(result.status).toBe('incomplete')
    expect(result.failure).toBeUndefined()
  })

  it('maps incomplete/content_filter to FAILED with a content_filter reason (not a clean partial)', async () => {
    const result = await consumeBrainDumpStream(
      eventStream([created('r'), delta(`${line({ title: 'A' })}\n`, 1), incomplete(2, 'content_filter')]),
      { startOrder: 0, onResponseId: async () => {}, onFlush: async () => {} },
      fakeLog,
    )
    expect(result.status).toBe('failed')
    expect(result.failure).toEqual({ reason: 'content_filter', message: null })
  })

  it('captures the model error message on a response.failed terminal', async () => {
    const result = await consumeBrainDumpStream(
      eventStream([created('r'), failed(1, 'upstream 500')]),
      { startOrder: 0, onResponseId: async () => {}, onFlush: async () => {} },
      fakeLog,
    )
    expect(result.status).toBe('failed')
    expect(result.failure).toEqual({ reason: 'model_error', message: 'upstream 500' })
  })

  it('captures a bare error event (transport failure) as a model_error terminal', async () => {
    const result = await consumeBrainDumpStream(
      eventStream([created('r'), { type: 'error', message: 'transport boom' } as ResponseEvent]),
      { startOrder: 0, onResponseId: async () => {}, onFlush: async () => {} },
      fakeLog,
    )
    expect(result.status).toBe('failed')
    expect(result.failure).toEqual({ reason: 'model_error', message: 'transport boom' })
  })

  it('flushes boundary-less drafts parsed before a failed terminal (partials stay committable)', async () => {
    const flushes: BrainDumpDraft[][] = []
    const a = line({ title: 'A' })
    const b = line({ title: 'B' })

    const result = await consumeBrainDumpStream(
      // A reaches a clean line, but the same delta's trailing partial (start of B, no newline) leaves the
      // buffer non-empty, so A sits un-flushed in `pending` when the run fails.
      eventStream([created('r'), delta(`${a}\n${b.slice(0, 10)}`, 1), failed(2, 'boom')]),
      {
        startOrder: 0,
        onResponseId: async () => {},
        onFlush: (drafts) => {
          flushes.push(drafts)
          return Promise.resolve()
        },
      },
      fakeLog,
    )

    expect(result.status).toBe('failed')
    // A was parsed before the failure — it must be persisted (spec: failed partials stay committable),
    // never silently dropped. The trailing partial B is an incomplete line and is correctly NOT flushed.
    expect(flushes.flat().map((d) => d.title)).toEqual(['A'])
  })

})

describe('buildFailureDetail', () => {
  it('content_filter: headline + persisted count + remediation, no model message', () => {
    const detail = buildFailureDetail({ reason: 'content_filter', message: null }, 3)
    expect(detail).toContain('content safety filter')
    expect(detail).toContain('3 items were saved')
    expect(detail).toContain('What to do:')
    expect(detail).not.toContain('Details:')
  })

  it('model_error: singular item phrasing + appended model message', () => {
    const detail = buildFailureDetail({ reason: 'model_error', message: 'upstream 500' }, 1)
    expect(detail).toContain('1 item was saved')
    expect(detail).toContain('Details: upstream 500')
  })

  it('model_error: zero-saved phrasing + remediation', () => {
    const detail = buildFailureDetail({ reason: 'model_error', message: null }, 0)
    expect(detail).toContain('0 items were saved')
    expect(detail).toContain('What to do:')
  })
})
