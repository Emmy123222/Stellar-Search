import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  buildCorsOptions,
  parseAllowedOrigins,
  isProductionEnv,
  getCorsStartupMessage,
} from './corsConfig';

describe('CORS Configuration', () => {
  const originalEnv = process.env.NODE_ENV;
  const originalAllowedOrigins = process.env.ALLOWED_ORIGINS;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    process.env.ALLOWED_ORIGINS = originalAllowedOrigins;
  });

  describe('parseAllowedOrigins', () => {
    it('should parse comma-separated origins and strip whitespace', () => {
      const result = parseAllowedOrigins('  https://app.stellar.com , https://admin.stellar.com  ');
      expect(result).toEqual(['https://app.stellar.com', 'https://admin.stellar.com']);
    });

    it('should remove empty entries resulting from extra commas', () => {
      const result = parseAllowedOrigins('https://app.stellar.com,, ,https://admin.stellar.com');
      expect(result).toEqual(['https://app.stellar.com', 'https://admin.stellar.com']);
    });

    it('should return empty array for empty string or undefined input', () => {
      expect(parseAllowedOrigins('')).toEqual([]);
      expect(parseAllowedOrigins(undefined)).toEqual([]);
    });
  });

  describe('Development Mode', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'development';
    });

    it('should return origin wildcard "*"', () => {
      const options = buildCorsOptions();
      expect(options.origin).toBe('*');
    });

    it('should return development startup message', () => {
      expect(getCorsStartupMessage()).toBe('CORS: * (development)');
    });
  });

  describe('Production Mode - Allowlist Behavior', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'production';
    });

    const checkOrigin = (
      options: ReturnType<typeof buildCorsOptions>,
      origin?: string
    ): Promise<{ err: Error | null; allow?: boolean }> => {
      return new Promise((resolve) => {
        if (typeof options.origin === 'function') {
          options.origin(origin, (err, allow) => {
            resolve({ err, allow: Boolean(allow) });
          });
        } else {
          resolve({ err: null, allow: options.origin === '*' || options.origin === true });
        }
      });
    };

    it('should allow origins in the allowlist', async () => {
      process.env.ALLOWED_ORIGINS = 'https://app.stellar.com,https://admin.stellar.com';
      const options = buildCorsOptions();

      const res1 = await checkOrigin(options, 'https://app.stellar.com');
      expect(res1.allow).toBe(true);

      const res2 = await checkOrigin(options, 'https://admin.stellar.com');
      expect(res2.allow).toBe(true);
    });

    it('should block hostile/unauthorized origins', async () => {
      process.env.ALLOWED_ORIGINS = 'https://app.stellar.com';
      const options = buildCorsOptions();

      const res = await checkOrigin(options, 'https://evil-site.com');
      expect(res.allow).toBe(false);
    });

    it('should handle whitespace and duplicates in ALLOWED_ORIGINS', async () => {
      process.env.ALLOWED_ORIGINS = '  https://app.stellar.com  , https://app.stellar.com ';
      const options = buildCorsOptions();

      const res = await checkOrigin(options, 'https://app.stellar.com');
      expect(res.allow).toBe(true);
    });

    it('should allow requests with no Origin header (curl, server-to-server, MCP)', async () => {
      process.env.ALLOWED_ORIGINS = 'https://app.stellar.com';
      const options = buildCorsOptions();

      const res = await checkOrigin(options, undefined);
      expect(res.allow).toBe(true);
    });

    it('should block cross-origin requests when ALLOWED_ORIGINS is empty', async () => {
      delete process.env.ALLOWED_ORIGINS;
      const options = buildCorsOptions();

      const res = await checkOrigin(options, 'https://app.stellar.com');
      expect(res.allow).toBe(false);
    });

    it('should return correct startup messages based on allowlist state', () => {
      delete process.env.ALLOWED_ORIGINS;
      expect(getCorsStartupMessage()).toBe('CORS: allowlist empty — cross-origin browser requests blocked');

      process.env.ALLOWED_ORIGINS = 'https://app.stellar.com';
      expect(getCorsStartupMessage()).toBe('CORS: allowlist (1 origin)');

      process.env.ALLOWED_ORIGINS = 'https://app.stellar.com,https://admin.stellar.com';
      expect(getCorsStartupMessage()).toBe('CORS: allowlist (2 origins)');
    });

    it('should include required headers for paid routes (x402 payment headers)', () => {
      process.env.ALLOWED_ORIGINS = 'https://app.stellar.com';
      const options = buildCorsOptions();

      expect(options.allowedHeaders).toContain('X-Payment');
      expect(options.allowedHeaders).toContain('payment-signature');
      expect(options.exposedHeaders).toContain('PAYMENT-REQUIRED');
      expect(options.exposedHeaders).toContain('X-Payment-Response');
    });
  });
});
