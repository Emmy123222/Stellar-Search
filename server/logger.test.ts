import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { privacySafeIp, privacySafeQuery } from './logger';

describe('logger privacy functions', () => {
  const originalDebugMode = process.env.DEBUG_LOGGING;

  afterEach(() => {
    if (originalDebugMode !== undefined) {
      process.env.DEBUG_LOGGING = originalDebugMode;
    } else {
      delete process.env.DEBUG_LOGGING;
    }
  });

  describe('default mode (DEBUG_LOGGING unset)', () => {
    beforeEach(() => {
      delete process.env.DEBUG_LOGGING;
    });

    it('should redact query text in default mode', () => {
      expect(privacySafeQuery('my search query')).toBeUndefined();
      expect(privacySafeQuery('')).toBeUndefined();
      expect(privacySafeQuery(null)).toBeUndefined();
      expect(privacySafeQuery(undefined)).toBeUndefined();
    });

    it('should hash IP addresses in default mode', () => {
      const ip = '192.168.1.1';
      const result = privacySafeIp(ip);
      expect(result).toMatch(/^ip:[a-f0-9]{16}$/);
      expect(result).not.toBe(ip);
      expect(result).not.toBe('ip:unknown');
    });

    it('should return ip:unknown for missing IP in default mode', () => {
      expect(privacySafeIp('')).toBe('ip:unknown');
      expect(privacySafeIp(null)).toBe('ip:unknown');
      expect(privacySafeIp(undefined)).toBe('ip:unknown');
    });
  });

  describe('debug mode (DEBUG_LOGGING=true)', () => {
    beforeEach(() => {
      process.env.DEBUG_LOGGING = 'true';
    });

    it('should return truncated query in debug mode', () => {
      const longQuery = 'a'.repeat(300);
      const result = privacySafeQuery(longQuery);
      expect(result).toBe('a'.repeat(200));
      expect(result?.length).toBe(200);
    });

    it('should return short query unchanged in debug mode', () => {
      const shortQuery = 'hello world';
      const result = privacySafeQuery(shortQuery);
      expect(result).toBe(shortQuery);
    });

    it('should return full IP address in debug mode', () => {
      const ip = '192.168.1.1';
      const result = privacySafeIp(ip);
      expect(result).toBe(ip);
      expect(result).not.toMatch(/^ip:[a-f0-9]{16}$/);
    });

    it('should return ip:unknown for missing IP in debug mode', () => {
      expect(privacySafeIp('')).toBe('ip:unknown');
      expect(privacySafeIp(null)).toBe('ip:unknown');
      expect(privacySafeIp(undefined)).toBe('ip:unknown');
    });
  });
});
