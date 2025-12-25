/**
 * E2E Test Constants
 *
 * Centralized constants for commonly used magic numbers across E2E tests.
 * This improves readability and makes it easier to tune timing values.
 */

/**
 * Polling interval used by agents when checking for new work
 */
export const DEFAULT_POLL_INTERVAL_MS = 100;

/**
 * Default maximum lease duration for claimed commands
 */
export const DEFAULT_MAX_LEASE_MS = 30000;

/**
 * Short lease duration used for testing lease expiry scenarios
 */
export const SHORT_LEASE_MS = 100;

/**
 * Wait duration after a short lease to ensure it has expired
 */
export const LEASE_EXPIRY_WAIT_MS = 200;

/**
 * Default timeout for waitFor/waitForValue utilities
 */
export const DEFAULT_WAIT_TIMEOUT_MS = 10000;

/**
 * Timeout for longer-running tests (e.g., tests involving lease expiry waits)
 */
export const LONG_TEST_TIMEOUT_MS = 60000;

/**
 * Timeout for very long-running tests (e.g., crash recovery tests)
 */
export const VERY_LONG_TEST_TIMEOUT_MS = 90000;

/**
 * Maximum characters allowed in HTTP response body before truncation
 */
export const BODY_TRUNCATION_LIMIT = 10240;
