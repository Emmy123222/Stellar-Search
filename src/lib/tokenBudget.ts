// Estimated 1 token ≈ 4 characters. A 4000 token budget ≈ 16,000 characters.
export const MAX_CONVERSATION_CHARS = 16000;

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export function enforceTokenBudget(
  messages: Message[],
  maxChars = MAX_CONVERSATION_CHARS
): { truncatedMessages: Message[]; wasTruncated: boolean } {
  if (!messages || messages.length === 0) return { truncatedMessages: [], wasTruncated: false };

  // Keep all system messages at the start
  const systemMessages: Message[] = [];
  let nonSystemIndex = 0;
  while (nonSystemIndex < messages.length && messages[nonSystemIndex].role === 'system') {
    systemMessages.push(messages[nonSystemIndex]);
    nonSystemIndex++;
  }

  const history = messages.slice(nonSystemIndex);
  let currentChars = systemMessages.reduce((sum, m) => sum + m.content.length, 0);
  let keepCount = 0;

  // Walk backwards to keep the most relevant recent turns
  for (let i = history.length - 1; i >= 0; i--) {
    const msgChars = history[i].content.length;
    if (currentChars + msgChars > maxChars && keepCount > 0) {
      break;
    }
    currentChars += msgChars;
    keepCount++;
  }

  const wasTruncated = keepCount < history.length;
  const truncatedHistory = history.slice(history.length - keepCount);
  const truncatedMessages = [...systemMessages, ...truncatedHistory];

  return { truncatedMessages, wasTruncated };
}
