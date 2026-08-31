import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'server/**/*.test.{ts,tsx}', 'mcp-server/**/*.test.{ts,tsx}', 'api/**/*.test.{ts,tsx}'],
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      reporter: ['text', 'json', 'html', 'lcov', 'text-summary'],
      include: ['src/**/*.{ts,tsx}', 'server/**/*.ts', 'mcp-server/**/*.ts', 'api/**/*.ts'],
      exclude: [
        '**/*.test.*',
        '**/*.spec.*',
        'src/vite-env.d.ts',
        'dist/**',
        'coverage/**',
        'node_modules/**',
        'vite.config.ts',
        'vitest.setup.ts',
      ],
      thresholds: {
        statements: 35,
        branches: 30,
        functions: 27,
        lines: 35,
        // Critical modules ratchet upward — keep Express, Vercel, browser, and MCP aligned
        // Bump these as coverage improves; CI fails if a PR drops below the ratchet.
        'src/lib/constants.ts': { statements: 90, branches: 60, functions: 100, lines: 90 },
        'src/lib/stellar.ts': { statements: 85, branches: 75, functions: 85, lines: 85 },
        'src/lib/paymentIntegrity.ts': { statements: 90, branches: 85, functions: 95, lines: 90 },
        'src/lib/serperNormalizer.ts': { statements: 95, branches: 90, functions: 100, lines: 95 },
        'server/corsConfig.ts': { statements: 90, branches: 85, functions: 95, lines: 90 },
        'src/components/search/SearchBar.tsx': { statements: 80, branches: 80, functions: 90, lines: 80 },
        'server/index.ts': { statements: 50, branches: 50, functions: 50, lines: 50 },
        'api/search.ts': { statements: 90, branches: 75, functions: 80, lines: 90 },
        'api/search/batch.ts': { statements: 60, branches: 55, functions: 60, lines: 60 },
        'api/jobs.ts': { statements: 60, branches: 55, functions: 60, lines: 60 },
        'api/jobs/[id].ts': { statements: 80, branches: 50, functions: 100, lines: 80 },
        'api/health.ts': { statements: 80, branches: 50, functions: 100, lines: 80 },
        'api/ai/chat.ts': { statements: 90, branches: 60, functions: 60, lines: 90 },
        'mcp-server/index.ts': { statements: 30, branches: 20, functions: 20, lines: 30 },
        'src/hooks/useFreighterWallet.ts': { statements: 85, branches: 65, functions: 90, lines: 85 },
      },
    },
  },
  // Required for @stellar/stellar-sdk and @stellar/freighter-api in browser
  define: {
    global: 'globalThis',
  },
  resolve: {
    alias: {
      // Some Stellar SDK internals use 'buffer'
      buffer: 'buffer',
    },
  },
  optimizeDeps: {
    include: ['buffer'],
    esbuildOptions: {
      define: {
        global: 'globalThis',
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      // Proxy API calls to backend during dev (avoids CORS)
      '/search': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/ai': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/health': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
