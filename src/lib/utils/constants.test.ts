import { describe, expect, it } from 'vitest'
import { dominantTypeColor, SYSTEM_TYPE_COLORS, languagesForItemType, remapLanguageForType } from '@/lib/utils/constants'

describe('dominantTypeColor', () => {
  it('returns null for an empty list', () => {
    expect(dominantTypeColor([])).toBeNull()
  })

  it('returns the color of the only type present', () => {
    expect(dominantTypeColor(['note', 'note', 'note'])).toBe(SYSTEM_TYPE_COLORS.note)
  })

  it('picks the most common type when types are mixed', () => {
    expect(dominantTypeColor(['snippet', 'note', 'note', 'link'])).toBe(SYSTEM_TYPE_COLORS.note)
  })

  it('breaks ties by SYSTEM_TYPE_ORDER (snippet before note)', () => {
    expect(dominantTypeColor(['note', 'snippet'])).toBe(SYSTEM_TYPE_COLORS.snippet)
  })

  it('returns null for an unknown type name', () => {
    expect(dominantTypeColor(['mystery'])).toBeNull()
  })
})

describe('languagesForItemType', () => {
  const ALL = ['bash', 'sh', 'zsh', 'typescript', 'python', 'dockerfile', 'go']

  it('restricts command to the shell/CLI set', () => {
    expect(languagesForItemType('command', ALL)).toEqual(['bash', 'sh', 'zsh', 'dockerfile'])
  })

  it('gives snippet the full list minus the shell set', () => {
    expect(languagesForItemType('snippet', ALL)).toEqual(['typescript', 'python', 'go'])
  })

  it('matches the shell set case-insensitively', () => {
    expect(languagesForItemType('command', ['BASH', 'Python'])).toEqual(['BASH'])
    expect(languagesForItemType('snippet', ['BASH', 'Python'])).toEqual(['Python'])
  })

  it('passes the full list through unchanged for any other type', () => {
    expect(languagesForItemType('note', ALL)).toEqual(ALL)
    expect(languagesForItemType('prompt', ALL)).toEqual(ALL)
  })
})

describe('remapLanguageForType', () => {
  it('clears language for types without a language (prompt/note)', () => {
    expect(remapLanguageForType('python', 'note')).toBeNull()
    expect(remapLanguageForType('bash', 'prompt')).toBeNull()
  })

  it('returns null for empty/absent language', () => {
    expect(remapLanguageForType(null, 'snippet')).toBeNull()
    expect(remapLanguageForType('', 'command')).toBeNull()
    expect(remapLanguageForType('   ', 'snippet')).toBeNull()
  })

  describe('→ command', () => {
    it('normalizes generic shell synonyms to bash', () => {
      expect(remapLanguageForType('shell', 'command')).toBe('bash')
      expect(remapLanguageForType('sh', 'command')).toBe('bash')
      expect(remapLanguageForType('ZSH', 'command')).toBe('bash')
      expect(remapLanguageForType('console', 'command')).toBe('bash')
    })

    it('keeps a distinct shell language already in the command set', () => {
      expect(remapLanguageForType('fish', 'command')).toBe('fish')
      expect(remapLanguageForType('powershell', 'command')).toBe('powershell')
      expect(remapLanguageForType('dockerfile', 'command')).toBe('dockerfile')
    })

    it('clears a programming language (not runnable as a command)', () => {
      expect(remapLanguageForType('python', 'command')).toBeNull()
      expect(remapLanguageForType('typescript', 'command')).toBeNull()
    })
  })

  describe('→ snippet', () => {
    it('keeps a programming language, preserving the original casing', () => {
      expect(remapLanguageForType('python', 'snippet')).toBe('python')
      expect(remapLanguageForType('TypeScript', 'snippet')).toBe('TypeScript')
    })

    it('clears a shell language (not a valid snippet language)', () => {
      expect(remapLanguageForType('bash', 'snippet')).toBeNull()
      expect(remapLanguageForType('powershell', 'snippet')).toBeNull()
    })

    it('clears a generic shell synonym not in COMMAND_LANGUAGES (symmetry with → command)', () => {
      // These normalize to "bash" on → command, so they must also be treated as shell (cleared) on
      // → snippet — never kept as a valid snippet language.
      expect(remapLanguageForType('console', 'snippet')).toBeNull()
      expect(remapLanguageForType('shellscript', 'snippet')).toBeNull()
      expect(remapLanguageForType('terminal', 'snippet')).toBeNull()
    })
  })
})
