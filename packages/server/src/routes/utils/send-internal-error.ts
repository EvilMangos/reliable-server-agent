import type { Response } from "express";

export function sendInternalError(res: Response, operation: string, error: unknown): void {
	console.error(`Failed to ${operation}:`, error);
	res.status(500).json({ error: `Failed to ${operation}` });
}
