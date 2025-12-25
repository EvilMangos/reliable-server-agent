/**
 * Format an unknown error value into a string message.
 * Handles both Error objects and other types.
 */
export function formatError(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}
