/**
 * featureFlags.ts
 * 
 * Feature flag system for controlled rollout of payment, AI, search-mode, and integration features.
 * 
 * Typed flags have documented defaults and separate server/client exposure.
 * Disabled features are absent from discovery/UI and cannot be invoked by direct requests.
 * 
 * Environment variables:
 * - Server-side: FEATURE_PAYMENT_ENABLED, FEATURE_AI_ENABLED, FEATURE_SEARCH_MODE_ENABLED, FEATURE_INTEGRATION_ENABLED
 * - Client-side: VITE_FEATURE_PAYMENT_ENABLED, VITE_FEATURE_AI_ENABLED, VITE_FEATURE_SEARCH_MODE_ENABLED, VITE_FEATURE_INTEGRATION_ENABLED
 * 
 * All flags default to true (enabled) for backward compatibility.
 */

// ─── Types ───────────────────────────────────────────────────────────────

/**
 * Feature flag configuration for server-side features
 */
export interface ServerFeatureFlags {
  /** Enable payment processing via x402 protocol */
  readonly paymentEnabled: boolean;
  
  /** Enable AI chat and suggestion features */
  readonly aiEnabled: boolean;
  
  /** Enable advanced search modes (image, news, etc.) */
  readonly searchModeEnabled: boolean;
  
  /** Enable third-party integrations (MCP server, etc.) */
  readonly integrationEnabled: boolean;
}

/**
 * Feature flag configuration for client-side features
 */
export interface ClientFeatureFlags {
  /** Show payment-related UI components */
  readonly paymentEnabled: boolean;
  
  /** Show AI assistant and related UI components */
  readonly aiEnabled: boolean;
  
  /** Show advanced search mode UI components */
  readonly searchModeEnabled: boolean;
  
  /** Show integration-related UI components */
  readonly integrationEnabled: boolean;
}

/**
 * Complete feature flag configuration with both server and client flags
 */
export interface FeatureFlags {
  readonly server: ServerFeatureFlags;
  readonly client: ClientFeatureFlags;
}

// ─── Environment Variable Helpers ────────────────────────────────────────

/**
 * Get environment variable with fallback, supporting both Node.js and Vite
 */
const getEnv = (key: string, fallback: string): string => {
  // Node.js environment (server)
  if (typeof process !== 'undefined' && process.env && process.env[key]) {
    return process.env[key];
  }
  
  // Vite environment (client)
  // @ts-ignore - import.meta.env is Vite-specific
  if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env[`VITE_${key}`]) {
    // @ts-ignore
    return import.meta.env[`VITE_${key}`];
  }
  
  return fallback;
};

/**
 * Parse boolean from environment variable
 * - "true", "1", "yes", "on" => true
 * - "false", "0", "no", "off" => false
 * - default: fallback
 */
const parseBoolEnv = (key: string, fallback: boolean): boolean => {
  const value = getEnv(key, fallback ? 'true' : 'false').toLowerCase();
  
  if (value === 'true' || value === '1' || value === 'yes' || value === 'on') {
    return true;
  }
  
  if (value === 'false' || value === '0' || value === 'no' || value === 'off') {
    return false;
  }
  
  return fallback;
};

// ─── Server Feature Flags ────────────────────────────────────────────────

/**
 * Get server-side feature flags from environment variables
 * 
 * Environment variables (server-side):
 * - FEATURE_PAYMENT_ENABLED: Enable payment processing (default: true)
 * - FEATURE_AI_ENABLED: Enable AI features (default: true)
 * - FEATURE_SEARCH_MODE_ENABLED: Enable search modes (default: true)
 * - FEATURE_INTEGRATION_ENABLED: Enable integrations (default: true)
 */
export const getServerFeatureFlags = (): ServerFeatureFlags => {
  return {
    paymentEnabled: parseBoolEnv('FEATURE_PAYMENT_ENABLED', true),
    aiEnabled: parseBoolEnv('FEATURE_AI_ENABLED', true),
    searchModeEnabled: parseBoolEnv('FEATURE_SEARCH_MODE_ENABLED', true),
    integrationEnabled: parseBoolEnv('FEATURE_INTEGRATION_ENABLED', true),
  };
};

// ─── Client Feature Flags ────────────────────────────────────────────────

/**
 * Get client-side feature flags from environment variables
 * 
 * Environment variables (client-side, prefixed with VITE_):
 * - VITE_FEATURE_PAYMENT_ENABLED: Show payment UI (default: true)
 * - VITE_FEATURE_AI_ENABLED: Show AI UI (default: true)
 * - VITE_FEATURE_SEARCH_MODE_ENABLED: Show search mode UI (default: true)
 * - VITE_FEATURE_INTEGRATION_ENABLED: Show integration UI (default: true)
 */
export const getClientFeatureFlags = (): ClientFeatureFlags => {
  return {
    paymentEnabled: parseBoolEnv('FEATURE_PAYMENT_ENABLED', true),
    aiEnabled: parseBoolEnv('FEATURE_AI_ENABLED', true),
    searchModeEnabled: parseBoolEnv('FEATURE_SEARCH_MODE_ENABLED', true),
    integrationEnabled: parseBoolEnv('FEATURE_INTEGRATION_ENABLED', true),
  };
};

// ─── Combined Feature Flags ──────────────────────────────────────────────

/**
 * Get complete feature flag configuration
 */
export const getFeatureFlags = (): FeatureFlags => {
  return {
    server: getServerFeatureFlags(),
    client: getClientFeatureFlags(),
  };
};

// ─── Runtime Validation ──────────────────────────────────────────────────

/**
 * Validate that feature flags are consistent between server and client
 * Returns array of validation errors, empty if valid
 */
export const validateFeatureFlags = (): string[] => {
  const server = getServerFeatureFlags();
  const client = getClientFeatureFlags();
  const errors: string[] = [];
  
  // Check for feature enablement mismatch
  if (server.paymentEnabled && !client.paymentEnabled) {
    errors.push('Payment enabled on server but disabled on client - UI will show disabled features');
  }
  
  if (!server.paymentEnabled && client.paymentEnabled) {
    errors.push('Payment disabled on server but enabled on client - UI will show features that will fail');
  }
  
  if (server.aiEnabled && !client.aiEnabled) {
    errors.push('AI enabled on server but disabled on client - UI will show disabled features');
  }
  
  if (!server.aiEnabled && client.aiEnabled) {
    errors.push('AI disabled on server but enabled on client - UI will show features that will fail');
  }
  
  if (server.searchModeEnabled && !client.searchModeEnabled) {
    errors.push('Search mode enabled on server but disabled on client - UI will show disabled features');
  }
  
  if (!server.searchModeEnabled && client.searchModeEnabled) {
    errors.push('Search mode disabled on server but enabled on client - UI will show features that will fail');
  }
  
  if (server.integrationEnabled && !client.integrationEnabled) {
    errors.push('Integration enabled on server but disabled on client - UI will show disabled features');
  }
  
  if (!server.integrationEnabled && client.integrationEnabled) {
    errors.push('Integration disabled on server but enabled on client - UI will show features that will fail');
  }
  
  return errors;
};

// ─── Feature Flag Documentation ──────────────────────────────────────────

/**
 * Generate documentation for current feature flag configuration
 */
export const getFeatureFlagDocumentation = (): string => {
  const server = getServerFeatureFlags();
  const client = getClientFeatureFlags();
  const errors = validateFeatureFlags();
  
  const lines = [
    'Feature Flag Configuration',
    '===========================',
    '',
    'Server-side Flags:',
    `- Payment Enabled: ${server.paymentEnabled}`,
    `- AI Enabled: ${server.aiEnabled}`,
    `- Search Mode Enabled: ${server.searchModeEnabled}`,
    `- Integration Enabled: ${server.integrationEnabled}`,
    '',
    'Client-side Flags:',
    `- Payment Enabled: ${client.paymentEnabled}`,
    `- AI Enabled: ${client.aiEnabled}`,
    `- Search Mode Enabled: ${client.searchModeEnabled}`,
    `- Integration Enabled: ${client.integrationEnabled}`,
    '',
  ];
  
  if (errors.length > 0) {
    lines.push('Validation Errors:');
    errors.forEach(error => lines.push(`- ${error}`));
    lines.push('');
  }
  
  lines.push('Environment Variables:');
  lines.push('- Server: FEATURE_PAYMENT_ENABLED, FEATURE_AI_ENABLED, FEATURE_SEARCH_MODE_ENABLED, FEATURE_INTEGRATION_ENABLED');
  lines.push('- Client: VITE_FEATURE_PAYMENT_ENABLED, VITE_FEATURE_AI_ENABLED, VITE_FEATURE_SEARCH_MODE_ENABLED, VITE_FEATURE_INTEGRATION_ENABLED');
  lines.push('');
  lines.push('Note: All flags default to "true" for backward compatibility.');
  
  return lines.join('\n');
};

// ─── Default Export ──────────────────────────────────────────────────────

export default {
  getServerFeatureFlags,
  getClientFeatureFlags,
  getFeatureFlags,
  validateFeatureFlags,
  getFeatureFlagDocumentation,
};