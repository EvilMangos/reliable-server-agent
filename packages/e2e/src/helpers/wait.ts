/**
 * Wait Utilities for E2E Tests
 *
 * Provides utilities for waiting on conditions with timeouts.
 */

export interface WaitOptions {
	timeoutMs?: number;
	intervalMs?: number;
}

/**
 * Wait for a condition to become true
 */
export async function waitFor(
	condition: () => boolean | Promise<boolean>,
	options: WaitOptions = {},
): Promise<void> {
	const { timeoutMs = 10000, intervalMs = 100 } = options;
	const startTime = Date.now();

	while (Date.now() - startTime < timeoutMs) {
		if (await condition()) {
			return;
		}
		await sleep(intervalMs);
	}

	throw new Error(`Timeout waiting for condition after ${timeoutMs}ms`);
}

/**
 * Wait for a value to become available
 */
export async function waitForValue<T>(
	getValue: () => T | null | undefined | Promise<T | null | undefined>,
	options: WaitOptions = {},
): Promise<T> {
	const { timeoutMs = 10000, intervalMs = 100 } = options;
	const startTime = Date.now();

	while (Date.now() - startTime < timeoutMs) {
		const value = await getValue();
		if (value !== null && value !== undefined) {
			return value;
		}
		await sleep(intervalMs);
	}

	throw new Error(`Timeout waiting for value after ${timeoutMs}ms`);
}

/**
 * Sleep for a specified duration
 */
export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry an async operation with exponential backoff
 */
export async function retry<T>(
	operation: () => Promise<T>,
	options: {
		maxAttempts?: number;
		initialDelayMs?: number;
		maxDelayMs?: number;
	} = {},
): Promise<T> {
	const { maxAttempts = 3, initialDelayMs = 100, maxDelayMs = 5000 } = options;
	let lastError: Error | undefined;
	let delay = initialDelayMs;

	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			return await operation();
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error));
			if (attempt < maxAttempts) {
				await sleep(delay);
				delay = Math.min(delay * 2, maxDelayMs);
			}
		}
	}

	throw lastError ?? new Error("Retry failed");
}
