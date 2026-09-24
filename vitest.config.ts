import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    // Registers @testing-library/jest-dom matchers (toBeInTheDocument, …) and
    // the non-secret env fixtures that modules validating config at import time
    // need. Without this every jest-dom assertion fails with "Invalid Chai
    // property".
    setupFiles: ['./vitest.setup.ts'],
  },
})
