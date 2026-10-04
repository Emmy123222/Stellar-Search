console.log("VITEST SETUP RUNNING")
import { expect } from 'vitest'
import * as matchers from '@testing-library/jest-dom/matchers'

expect.extend(matchers)

// Modules validate configuration at import time to mirror deployment startup.
// Provide non-secret fixtures before each test module is evaluated.
process.env.STELLAR_RECEIVING_ADDRESS ??= 'GAAZI4TCR3TY5OJHCTJC2A4AFL5MNSF3GAKGOWG5W2LBBGCS2TDPZOM3'
process.env.SERPER_API_KEY ??= 'test-serper-key'
