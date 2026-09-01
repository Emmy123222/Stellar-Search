/**
 * Shared runtime-neutral AI chat service
 * Used across Express server, Vercel Serverless API, browser UI, and MCP server.
 */

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
  options: ChatCompletionOptions
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
  })

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
