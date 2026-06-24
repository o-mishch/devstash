import 'server-only'

import OpenAI from 'openai'

let openai: OpenAI | null = null

export function getOpenAIClient(): OpenAI | null {
  if (!process.env.OPENAI_API_KEY) return null

  openai ??= new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    timeout: 30 * 1000,
    maxRetries: 2,
  })

  return openai
}

/**
 * Supported AI Models for DevStash
 * 
 * TAG (gpt-4.1-nano):
 * - Used for: Auto-tagging (classification, no reasoning required)
 * - Limits: 200,000 TPM | 500 RPM | 2,000,000 TPD
 * 
 * DEFAULT (gpt-5-mini):
 * - Used for: AI Summaries, Code Explanations, Prompt Optimization
 * - Limits: 500,000 TPM | 500 RPM | 5,000,000 TPD
 */
export const AI_MODELS = {
  TAG: 'gpt-4.1-nano',
  DEFAULT: 'gpt-5-mini',
} as const
