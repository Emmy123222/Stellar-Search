# Vercel API security headers

All serverless adapters call `applyServerlessHeaders` before handling a
request. The helper adds content-sniffing, framing, referrer, and permissions
policies while leaving x402 payment and SSE-specific headers available to the
individual route.
