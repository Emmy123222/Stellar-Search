import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

describe('Dockerfile & Container Configuration', () => {
  const rootDir = path.resolve(__dirname, '..')
  const dockerfilePath = path.join(rootDir, 'Dockerfile')
  const dockerignorePath = path.join(rootDir, '.dockerignore')
  const packageJsonPath = path.join(rootDir, 'package.json')

  it('Dockerfile exists and contains multi-stage build definitions', () => {
    expect(fs.existsSync(dockerfilePath)).toBe(true)
    const content = fs.readFileSync(dockerfilePath, 'utf8')

    // Multi-stage verification
    expect(content).toMatch(/FROM\s+node:20-alpine\s+AS\s+builder/i)
    expect(content).toMatch(/FROM\s+node:20-alpine\s+AS\s+runner/i)
  })

  it('Dockerfile defines unprivileged non-root user and switches to it', () => {
    const content = fs.readFileSync(dockerfilePath, 'utf8')

    // Security: user and group creation
    expect(content).toMatch(/addgroup\s+-g\s+1001\s+-S\s+nodejs/)
    expect(content).toMatch(/adduser\s+-S\s+nodejs\s+-u\s+1001\s+-G\s+nodejs/)
    expect(content).toMatch(/USER\s+nodejs/)
  })

  it('Dockerfile documents port 3001 and sets production environment', () => {
    const content = fs.readFileSync(dockerfilePath, 'utf8')

    expect(content).toMatch(/EXPOSE\s+3001/)
    expect(content).toMatch(/ENV\s+NODE_ENV=production/)
    expect(content).toMatch(/ENV\s+PORT=3001/)
  })

  it('Dockerfile configures a healthcheck probing the live /health endpoint', () => {
    const content = fs.readFileSync(dockerfilePath, 'utf8')

    expect(content).toMatch(/HEALTHCHECK\s+--interval=30s\s+--timeout=5s\s+--start-period=10s\s+--retries=3/i)
    expect(content).toMatch(/\/health/)
  })

  it('Dockerfile uses optimized production dependency installation', () => {
    const content = fs.readFileSync(dockerfilePath, 'utf8')

    // Runner stage should omit devDependencies
    expect(content).toMatch(/npm ci --omit=dev/)
  })

  it('.dockerignore exists and excludes sensitive/heavy files', () => {
    expect(fs.existsSync(dockerignorePath)).toBe(true)
    const content = fs.readFileSync(dockerignorePath, 'utf8')
    const lines = content.split('\n').map(l => l.trim()).filter(Boolean)

    expect(lines).toContain('node_modules')
    expect(lines).toContain('dist')
    expect(lines).toContain('coverage')
    expect(lines).toContain('.env')
    expect(lines).toContain('.git')
    expect(lines).toContain('.DS_Store')
  })

  it('package.json includes start and docker scripts', () => {
    expect(fs.existsSync(packageJsonPath)).toBe(true)
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))

    expect(pkg.scripts.start).toBe('tsx server/index.ts')
    expect(pkg.scripts['docker:build']).toBe('docker build -t stellar-search .')
    expect(pkg.scripts['docker:run']).toBe('docker run -p 3001:3001 --env-file .env stellar-search')
    expect(pkg.dependencies.tsx).toBeDefined()
  })
})
