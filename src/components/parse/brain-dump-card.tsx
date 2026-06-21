'use client'

import { useMemo, useRef, useState, type ChangeEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Sparkles, Upload, Loader2, Clipboard, FolderOpen, Info } from 'lucide-react'
import { toast } from 'sonner'
import {
  SPLIT_FILE_MIN_INPUT_CHARS,
  SPLIT_FILE_MAX_INPUT_CHARS,
  SPLIT_FILE_MAX_PASTE_BYTES,
  SPLIT_FILE_ALLOWED_EXTS,
  FILE_MAX_BYTES,
  BRAIN_DUMP_SOURCE_TAG,
} from '@/lib/utils/constants'
import { formatBytes } from '@/lib/utils/format'
import { uploadFileItem } from '@/lib/storage-client/upload-file-item-client'
import {
  useCreateBrainDumpJob,
  useActiveBrainDumpJobs,
  useBrainDumpSources,
  type CreateBrainDumpResult,
  type BrainDumpSource,
} from '@/hooks/use-brain-dump'
import { useUpgradePromptStore } from '@/stores/upgrade-prompt'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Progress } from '@/components/ui/progress'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip'

type Mode = 'paste' | 'upload' | 'select'

const UPGRADE_PROMPT = {
  title: 'Brain Dump is a Pro feature',
  description: 'Upgrade to split a long file into ready-to-save items with AI.',
}

interface BrainDumpCardProps {
  isPro: boolean
}

export function BrainDumpCard({ isPro }: BrainDumpCardProps) {
  const router = useRouter()
  const createJob = useCreateBrainDumpJob()
  const { openPrompt } = useUpgradePromptStore()
  const { data: activeJobs } = useActiveBrainDumpJobs()
  const awaitingReview = activeJobs?.jobs.length ?? 0
  // De-duped so repeated re-parses of the same source don't repeat the name in the tooltip.
  const pendingSourceNames = [...new Set(activeJobs?.jobs.map((job) => job.sourceName ?? 'Unknown source') ?? [])]

  const [mode, setMode] = useState<Mode>('paste')
  const [text, setText] = useState('')
  // One flag covers uploading + job creation so every CTA disables together.
  const [busy, setBusy] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Only fetch the picker list when a Pro user is on the "select" tab.
  const sourcesQuery = useBrainDumpSources(isPro && mode === 'select')
  const sources = sourcesQuery.data?.sources ?? []

  const nonBlank = useMemo(() => text.replace(/\s/g, '').length, [text])
  const overPasteCap = useMemo(() => new TextEncoder().encode(text).length > SPLIT_FILE_MAX_PASTE_BYTES, [text])
  const overWindow = text.length > SPLIT_FILE_MAX_INPUT_CHARS
  const tooShort = nonBlank < SPLIT_FILE_MIN_INPUT_CHARS

  const ensurePro = (): boolean => {
    if (isPro) return true
    openPrompt(UPGRADE_PROMPT)
    return false
  }

  // Finalizes any create path: surface failures, otherwise toast (noting truncation) and go to review.
  const finishCreate = (result: CreateBrainDumpResult): void => {
    if (!result.ok) {
      setBusy(false)
      if (result.status === 403) {
        openPrompt(UPGRADE_PROMPT)
        return
      }
      toast.error(result.message ?? 'Could not start the split')
      return
    }
    const label = result.sourceName ? `“${result.sourceName}”` : 'your source'
    toast.success(
      result.truncated
        ? `Saved ${label} to your stash — the first ${SPLIT_FILE_MAX_INPUT_CHARS.toLocaleString()} characters were parsed.`
        : `Saved ${label} to your stash and started parsing.`,
    )
    router.push(`/parse/${result.jobId}`)
  }

  const startPaste = async (): Promise<void> => {
    if (!ensurePro()) return
    setBusy(true)
    finishCreate(await createJob({ text }))
  }

  const startFromSource = async (sourceItemId: string): Promise<void> => {
    if (!ensurePro()) return
    setBusy(true)
    finishCreate(await createJob({ sourceItemId }))
  }

  // Upload reuses the existing file-item flow: presign → direct browser→S3 → createItem type `file`
  // (tagged brain-dump, a permanent Files-tab item) → start the job referencing that item.
  const onFile = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0]
    event.target.value = '' // allow re-selecting the same file
    if (!file) return
    if (!ensurePro()) return

    const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
    if (!SPLIT_FILE_ALLOWED_EXTS.has(ext)) {
      toast.error('Only .txt and .md files are supported')
      return
    }
    if (file.size > FILE_MAX_BYTES) {
      toast.error(`File is too large (max ${formatBytes(FILE_MAX_BYTES)})`)
      return
    }

    setBusy(true)
    setUploadProgress(0)
    const uploaded = await uploadFileItem({
      file,
      title: file.name,
      tags: [BRAIN_DUMP_SOURCE_TAG],
      onProgress: setUploadProgress,
    })
    setUploadProgress(null)
    if (!uploaded.ok) {
      setBusy(false)
      toast.error(uploaded.message)
      return
    }
    finishCreate(await createJob({ sourceItemId: uploaded.itemId }))
  }

  const counterClass = overPasteCap || overWindow ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'

  return (
    <TooltipProvider delay={150}>
      <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
        <div className="flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Sparkles className="size-4" />
          </div>
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              Brain Dump
              {awaitingReview > 0 && (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Badge variant="secondary" className="text-[10px]">
                        {awaitingReview} awaiting review
                      </Badge>
                    }
                  />
                  <TooltipContent className="max-w-[260px]">
                    {pendingSourceNames.join(', ')}
                  </TooltipContent>
                </Tooltip>
              )}
            </h2>
            <p className="text-xs text-muted-foreground">
              Paste, upload, or pick a file — AI splits it into ready-to-save items.
            </p>
          </div>
        </div>

        <Tabs value={mode} onValueChange={(value) => setMode(value as Mode)} className="mt-4">
          <TabsList>
            <TabsTrigger value="paste">
              <Clipboard className="size-4" /> Paste
            </TabsTrigger>
            <TabsTrigger value="upload">
              <Upload className="size-4" /> Upload
            </TabsTrigger>
            <TabsTrigger value="select">
              <FolderOpen className="size-4" /> My files
            </TabsTrigger>
          </TabsList>

          <TabsContent value="paste" className="mt-3">
            <Textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Paste your project notes, snippets, commands, links…"
              rows={8}
              className="font-mono text-xs"
            />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <span className={counterClass}>
                {text.length.toLocaleString()} / {SPLIT_FILE_MAX_INPUT_CHARS.toLocaleString()} parsed
              </span>
              <Button size="sm" onClick={startPaste} disabled={busy || tooShort || overPasteCap}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                Split into items
              </Button>
            </div>
            {overPasteCap && (
              <p className="mt-1 text-xs text-destructive">
                This paste is very large — upload it as a file instead.
              </p>
            )}
            {!overPasteCap && overWindow && (
              <p className="mt-1 text-xs text-muted-foreground">
                Your full note is saved; the first {SPLIT_FILE_MAX_INPUT_CHARS.toLocaleString()} characters are parsed
                into items.
              </p>
            )}
            {tooShort && text.length > 0 && (
              <p className="mt-1 text-xs text-muted-foreground">
                Add at least {SPLIT_FILE_MIN_INPUT_CHARS} characters to split.
              </p>
            )}
          </TabsContent>

          <TabsContent value="upload" className="mt-3">
            <input ref={fileInputRef} type="file" accept=".txt,.md" onChange={onFile} className="hidden" />
            <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border p-6 text-center">
              <Upload className="size-5 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">
                Upload a .txt or .md file. It’s saved to your Files and parsed into items.
              </p>
              {uploadProgress !== null ? (
                <Progress value={uploadProgress} className="mt-1 h-1.5 w-40" />
              ) : (
                <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={busy}>
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
                  Choose file
                </Button>
              )}
            </div>
          </TabsContent>

          <TabsContent value="select" className="mt-3">
            {sourcesQuery.isLoading ? (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Loading your files…
              </p>
            ) : (
              <SourcePicker
                sources={sources}
                selectedId={selectedSourceId}
                busy={busy}
                onSelect={setSelectedSourceId}
                onStart={() => selectedSourceId && startFromSource(selectedSourceId)}
              />
            )}
          </TabsContent>
        </Tabs>

        <div className="mt-3 flex items-start gap-1.5 text-[11px] text-muted-foreground">
          <Info className="mt-px size-3.5 shrink-0" />
          <p>
            Your source is saved to your stash (tagged <code className="text-foreground">{BRAIN_DUMP_SOURCE_TAG}</code>)
            so you can re-parse it later. Text is sent to OpenAI.{' '}
            <Tooltip>
              <TooltipTrigger
                render={<button type="button" className="underline decoration-dotted underline-offset-2" />}
              >
                Learn more
              </TooltipTrigger>
              <TooltipContent className="max-w-[260px]">
                Background parsing requires OpenAI to store the response (~30 days, visible in their dashboard logs).
                This feature is not Zero-Data-Retention compatible.
              </TooltipContent>
            </Tooltip>
          </p>
        </div>
      </div>
    </TooltipProvider>
  )
}

interface SourcePickerProps {
  sources: BrainDumpSource[]
  selectedId: string | null
  busy: boolean
  onSelect: (id: string) => void
  onStart: () => void
}

function SourcePicker({ sources, selectedId, busy, onSelect, onStart }: SourcePickerProps) {
  if (sources.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No text files in your stash yet. Upload a .txt or .md file, then it shows up here.
      </p>
    )
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex max-h-48 flex-col gap-1 overflow-y-auto">
        {sources.map((source) => (
          <button
            key={source.itemId}
            type="button"
            onClick={() => onSelect(source.itemId)}
            className={
              selectedId === source.itemId
                ? 'flex items-center justify-between gap-2 rounded-lg border border-primary/60 bg-primary/5 px-3 py-2 text-left'
                : 'flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-left hover:bg-accent/40'
            }
          >
            <span className="min-w-0 flex-1 truncate text-xs font-medium">{source.name}</span>
            {source.sizeBytes !== null && (
              <span className="shrink-0 text-[11px] text-muted-foreground">{formatBytes(source.sizeBytes)}</span>
            )}
          </button>
        ))}
      </div>
      <Button size="sm" className="self-end" onClick={onStart} disabled={busy || !selectedId}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
        Split into items
      </Button>
    </div>
  )
}
