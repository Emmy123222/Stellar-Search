# Vercel API security & response compression headers

All serverless adapters call `applyServerlessHeaders` before handling a request. The helper adds content-sniffing, framing, referrer, and permissions policies while leaving x402 payment and SSE-specific headers available to the individual route.

Additionally, `applyServerlessHeaders` sets `Vary: Accept-Encoding` and attaches compression negotiation (`attachServerlessCompression`) for compressible JSON and text responses that exceed the size threshold (default 1024 bytes), negotiating Brotli (`br`) or Gzip (`gzip`) when requested by client `Accept-Encoding`.
