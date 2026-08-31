import type { VercelRequest, VercelResponse } from "@vercel/node";
import Groq from "groq-sdk";

export const AVAILABLE_MODELS = [
  "llama-3.3-70b-versatile",
  "llama-3.1-8b-instant",
  "mixtral-8x7b-32768",
] as const;

export type AvailableModel = (typeof AVAILABLE_MODELS)[number];

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY || "dummy_key" });

function sanitizeClientMessages(
  messages: unknown,
):
  | { ok: true; value: { role: "user" | "assistant"; content: string }[] }
  | { ok: false; error: string } {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { ok: false, error: "messages array required" };
  }

  const sanitized: { role: "user" | "assistant"; content: string }[] = [];

  for (const message of messages) {
    if (!message || typeof message !== "object") {
      return {
        ok: false,
        error: "Messages must be objects with role and content",
      };
    }

    const { role, content } = message as { role?: unknown; content?: unknown };

    if (role === "system") {
      return {
        ok: false,
        error: "Client messages may only use user or assistant roles",
      };
    }

    if (role !== "user" && role !== "assistant") {
      return {
        ok: false,
        error: "Client messages must use user or assistant roles",
      };
    }

    if (typeof content !== "string") {
      return { ok: false, error: "Message content must be a string" };
    }

    sanitized.push({ role, content });
  }

  return { ok: true, value: sanitized };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const {
    messages,
    model: requestedModel,
    context: trustedContext,
  } = (req.body || {}) as {
    messages?: { role: "system" | "user" | "assistant"; content: string }[];
    model?: string;
    stream?: boolean;
    context?: string;
  };

  const sanitizedMessages = sanitizeClientMessages(messages);
  if (!sanitizedMessages.ok) {
    return res.status(400).json({ error: sanitizedMessages.error });
  }

  const model: AvailableModel =
    requestedModel &&
    (AVAILABLE_MODELS as readonly string[]).includes(requestedModel)
      ? (requestedModel as AvailableModel)
      : "llama-3.3-70b-versatile";

  const wantsStream =
    (req.headers?.accept || "").includes("text/event-stream") ||
    (req.body as any)?.stream === true ||
    req.query?.stream === "1";

  const trustedSystemContext =
    typeof trustedContext === "string" && trustedContext.trim()
      ? trustedContext.trim()
      : null;

  const groqMessages = [
    {
      role: "system" as const,
      content:
        "You are StellarSearch AI, a concise research assistant. Help users craft better search queries and understand results. Keep responses under 200 words.",
    },
    ...(trustedSystemContext
      ? [{ role: "system" as const, content: trustedSystemContext }]
      : []),
    ...sanitizedMessages.value,
  ];

  if (!wantsStream) {
    try {
      const completion = await groq.chat.completions.create({
        model,
        messages: groqMessages,
        max_tokens: 512,
        temperature: 0.7,
      });

      const content = completion.choices[0]?.message?.content || "No response.";
      return res.json({ content, model: completion.model || model });
    } catch (err: any) {
      console.error("[groq error]", err?.message || err);
      return res
        .status(500)
        .json({ error: `Groq AI error: ${err?.message || err}` });
    }
  }

  // SSE streaming path
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  if (typeof (res as any).flushHeaders === "function") {
    (res as any).flushHeaders();
  }

  const sendEvent = (event: string, data: Record<string, unknown>) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const controller = new AbortController();
  if (typeof req.on === "function") {
    req.on("close", () => controller.abort());
  }

  try {
    const stream = await groq.chat.completions.create(
      {
        model,
        messages: groqMessages,
        max_tokens: 512,
        temperature: 0.7,
        stream: true,
      },
      { signal: controller.signal },
    );

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) sendEvent("delta", { content: delta });
    }
    sendEvent("done", { model });
    res.end();
  } catch (err: any) {
    if (controller.signal.aborted) {
      return res.end();
    }
    console.error("[groq stream error]", err?.message || err);
    sendEvent("error", { error: `Groq AI error: ${err?.message || err}` });
    res.end();
  }
}
