/**
 * Sleep for a specified number of milliseconds.
 * Simple promise-based delay utility.
 */
export function sleep(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}
