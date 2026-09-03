# AI chat adapter contract

The Express and Vercel `/ai/chat` handlers use the same runtime-neutral chat
service for message validation, model selection, JSON completion fallback, and
SSE streaming. Tests mock Groq at the service boundary so behavior can be
verified without network calls.
