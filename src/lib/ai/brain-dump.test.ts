import { vi, describe, it, expect } from 'vitest'
import type OpenAI from 'openai'
import {
  parseBrainDumpLine,
  consumeBrainDumpStream,
  type BrainDumpDraft,
} from './brain-dump'
import { SPLIT_FILE_MAX_ITEMS } from '@/lib/utils/constants'

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
})

describe('consumeBrainDumpStream', () => {
  const fakeLog = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never

  function created(id: string): ResponseEvent {
    return { type: 'response.created', response: { id } } as ResponseEvent
  }
  function delta(text: string, seq: number): ResponseEvent {
    return { type: 'response.output_text.delta', delta: text, sequence_number: seq } as ResponseEvent
  }
  function completed(seq: number): ResponseEvent {
    return { type: 'response.completed', sequence_number: seq } as ResponseEvent
  }
  function incomplete(seq: number): ResponseEvent {
    return { type: 'response.incomplete', sequence_number: seq } as ResponseEvent
  }

  function line(fields: Partial<BrainDumpDraft>): string {
    return JSON.stringify({ itemTypeName: 'note', ...fields })
  }

  async function* eventStream(events: ResponseEvent[]): AsyncIterable<ResponseEvent> {
    for (const e of events) {
      yield e
    }
  }

  it('captures responseId on response.created', async () => {
    const onResponseId = vi.fn()
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
        onFlush: async (drafts, startOrder, cursor) => {
          flushes.push({ drafts, startOrder, cursor })
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
        onFlush: async (drafts) => {
          flushes.push(drafts)
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
        onFlush: async (drafts, startOrder, cursor) => {
          flushes.push({ drafts, cursor })
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
        onFlush: async (drafts) => {
          items.push(...drafts)
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

  it('caps persisted drafts at SPLIT_FILE_MAX_ITEMS and stops, even when the stream emits more', async () => {
    const items: BrainDumpDraft[] = []
    // One delta carrying MAX + 5 complete lines — more than the per-job cap allows.
    const overCap = Array.from({ length: SPLIT_FILE_MAX_ITEMS + 5 }, (_, i) =>
      line({ itemTypeName: 'note', title: `N${i}`, content: `c${i}` }),
    ).join('\n')

    const result = await consumeBrainDumpStream(
      eventStream([created('resp_1'), delta(`${overCap}\n`, 1), completed(2)]),
      {
        startOrder: 0,
        onResponseId: async () => {},
        onFlush: async (drafts) => {
          items.push(...drafts)
        },
      },
      fakeLog,
    )

    // The cap is a hard ceiling: never persist more than MAX, and never overshoot it.
    expect(items.length).toBe(SPLIT_FILE_MAX_ITEMS)
    expect(result.emitted).toBe(SPLIT_FILE_MAX_ITEMS)
    expect(result.status).toBe('completed')
  })
})
