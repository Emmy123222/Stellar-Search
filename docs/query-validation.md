# Query validation

`src/lib/queryValidation.ts` is the side-effect-free validator shared by the
Express and Vercel search adapters. It trims input, preserves Unicode, removes
ASCII controls, rejects empty values, and enforces the 256-character boundary.
