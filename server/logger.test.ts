import { describe, it, expect } from 'vitest';
import logger from './logger';

describe('logger', () => {
  it('should be defined and configured correctly', () => {
    expect(logger).toBeDefined();
    expect(logger.level).toBe('info');
    expect(logger.transports.length).toBeGreaterThan(0);
  });
});
