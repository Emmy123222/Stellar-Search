import '@testing-library/jest-dom/vitest'

// Modules validate configuration at import time to mirror deployment startup.
// Provide non-secret fixtures before each test module is evaluated.
process.env.STELLAR_RECEIVING_ADDRESS ??= 'GAAZI4TCR3TY5OJHCTJC2A4AFL5MNSF3GAKGOWG5W2LBBGCS2TDPZOM3'
process.env.SERPER_API_KEY ??= 'test-serper-key'
