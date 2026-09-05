/**
 * Shared runtime-neutral AI chat service
 * Used across Express server, Vercel Serverless API, browser UI, and MCP server.
 */
import type { ReportFormat } from '../types/index'

/** A minimal source descriptor used when building research prompts. */
export interface ResearchSource {
  id: string
  title: string
  url: string
  description: string
}

/** Result of buildResearchPrompt — the ready-to-send prompt plus book-keeping. */
export interface ResearchPromptResult {
  /** The full prompt string to send to the AI. */
  prompt: string
  /**
   * IDs that were present in allSourceIds but NOT in selectedIds.
   * These are the sources the user deliberately excluded; they should be
   * recorded in the generated ResearchReport.omitted list.
   */
  omittedIds: string[]
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatCompletionOptions {
  messages: ChatMessage[]
  model?: string
  systemPrompt?: string
  maxTokens?: number
  temperature?: number
}

export interface ChatCompletionResult {
  content: string
  model: string
}

export const AVAILABLE_MODELS = [
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant',
  'mixtral-8x7b-32768',
] as const

export type SupportedModel = typeof AVAILABLE_MODELS[number]

export const DEFAULT_MODEL: SupportedModel = 'llama-3.3-70b-versatile'

export const DEFAULT_SYSTEM_PROMPT =
  'You are StellarSearch AI, a concise research assistant. Help users craft better search queries and understand results. Keep responses under 200 words.'

export const DEFAULT_MAX_TOKENS = 512
export const DEFAULT_TEMPERATURE = 0.7

/**
 * Validates and resolves the model to use.
 * Returns the requested model if valid, otherwise falls back to DEFAULT_MODEL.
 */
export function resolveModel(requestedModel?: string | null): string {
  if (requestedModel && (AVAILABLE_MODELS as readonly string[]).includes(requestedModel)) {
    return requestedModel
  }
  return DEFAULT_MODEL
}

/**
 * Validates the chat messages array.
 * Returns null if valid, or an error string message if invalid.
 */
export function validateChatMessages(messages: unknown): string | null {
  if (!Array.isArray(messages) || messages.length === 0) {
    return 'messages array required'
  }

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    if (!msg || typeof msg !== 'object') {
      return `Invalid message at index ${i}: expected object`
    }
    if (!['system', 'user', 'assistant'].includes(msg.role)) {
      return `Invalid role at index ${i}: must be 'system', 'user', or 'assistant'`
    }
    if (typeof msg.content !== 'string' || msg.content.trim() === '') {
      return `Invalid content at index ${i}: must be a non-empty string`
    }
  }

  return null
}

/**
 * Prepends the system prompt if one is not already provided.
 */
export function buildChatMessages(
  messages: ChatMessage[],
  systemPrompt: string = DEFAULT_SYSTEM_PROMPT
): ChatMessage[] {
  const hasSystem = messages.some((m) => m.role === 'system')
  if (hasSystem) {
    return [...messages]
  }
  return [
    { role: 'system', content: systemPrompt },
    ...messages,
  ]
}

/**
 * Executes a non-streaming chat completion with Groq.
 */
export async function executeChatCompletion(
  groqClient: any,
  options: ChatCompletionOptions,
  signal?: AbortSignal
): Promise<ChatCompletionResult> {
  const model = resolveModel(options.model)
  const messages = buildChatMessages(options.messages, options.systemPrompt)
  const max_tokens = options.maxTokens ?? DEFAULT_MAX_TOKENS
  const temperature = options.temperature ?? DEFAULT_TEMPERATURE

  const completion = await groqClient.chat.completions.create({
    model,
    messages,
    max_tokens,
    temperature,
  }, signal ? { signal } : undefined)

  const content = completion.choices?.[0]?.message?.content || 'No response.'
  return {
    content,
    model: completion.model || model,
  }
}

/**
 * Initiates a streaming chat completion with Groq.
 */
export async function streamChatCompletion(
  groqClient: any,
  options: ChatCompletionOptions,
  signal?: AbortSignal
): Promise<any> {
  const model = resolveModel(options.model)
  const messages = buildChatMessages(options.messages, options.systemPrompt)
  const max_tokens = options.maxTokens ?? DEFAULT_MAX_TOKENS
  const temperature = options.temperature ?? DEFAULT_TEMPERATURE

  return groqClient.chat.completions.create(
    {
      model,
      messages,
      max_tokens,
      temperature,
      stream: true,
    },
    signal ? { signal } : undefined
  )
}

/**
 * Normalizes and formats AI error messages.
 */
export function formatAiError(err: any): { message: string } {
  const rawMsg = err?.message || String(err)
  return {
    message: `Groq AI error: ${rawMsg}`,
  }
}

// ─── Format instruction strings ────────────────────────────────────────────

const FORMAT_INSTRUCTIONS: Record<ReportFormat, string> = {
  bullets: [
    'Write a concise bullet-point summary (3–7 bullets).',
    'Each bullet must cite its source(s) using [N] notation.',
    'Group related findings under one bullet where possible.',
  ].join(' '),
  narrative: [
    'Write a flowing prose summary (2–4 paragraphs).',
    'Cite sources inline with [N] notation.',
    'Do not use headers or bullet lists — use natural paragraph flow.',
  ].join(' '),
  table: [
    'Produce a Markdown table with columns: Source [N] | Key Claim | Detail.',
    'One row per source. Do not include any text outside the table.',
  ].join(' '),
  comparison: [
    'Compare and contrast the sources\' positions on the topic.',
    'Organise by theme: agreements first, then disagreements.',
    'Cite sources inline with [N] notation.',
    'Use short paragraphs rather than bullet points.',
  ].join(' '),
}

/**
 * Builds a format-specific research prompt and computes the list of omitted
 * source IDs (those present in allSourceIds but absent from selectedIds).
 *
 * @param query          - The original search query string.
 * @param sources        - The full list of available sources (only those whose
 *                         id appears in selectedIds will be included in the
 *                         prompt context).
 * @param format         - The desired output format.
 * @param allSourceIds   - IDs of every source in the result set (used to
 *                         determine which sources were omitted).
 */
export function buildResearchPrompt(
  query: string,
  sources: ResearchSource[],
  format: ReportFormat,
  allSourceIds: string[],
): ResearchPromptResult {
  const selectedSet = new Set(sources.map((s) => s.id))
  const omittedIds = allSourceIds.filter((id) => !selectedSet.has(id))

  const sourceBlock = sources
    .map((s, idx) =>
      `[${idx + 1}] ${s.title}\n    URL: ${s.url}\n    Excerpt: ${s.description}`,
    )
    .join('\n\n')

  const formatInstruction = FORMAT_INSTRUCTIONS[format]

  const prompt = [
    `You are a research assistant. The user searched for: "${query}".`,
    ``,
    `Below are ${sources.length} selected source(s). ` +
      `Cite them using [1], [2], … [${sources.length}] notation.`,
    ``,
    sourceBlock,
    ``,
    `---`,
    ``,
    `Instructions: ${formatInstruction}`,
    ``,
    `At the very end of your response, include a "Sources Used" section that ` +
      `lists each source number, its title, and its URL, like:`,
    ``,
    `Sources Used:`,
    ...sources.map((s, idx) => `[${idx + 1}] ${s.title} — ${s.url}`),
  ].join('\n')

  return { prompt, omittedIds }
}
