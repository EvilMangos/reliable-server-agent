import { ValidationError } from "../errors/index.js";

/**
 * Validates that a field exists and is a number
 * @throws ValidationError if field is missing or not a number
 */
export function requireNumber(body: unknown, field: string): number {
	const b = body as Record<string, unknown>;
	if (typeof b[field] !== "number") {
		throw new ValidationError(`Missing or invalid ${field}`);
	}
	return b[field] as number;
}

/**
 * Validates that a field exists and is a non-empty string
 * @throws ValidationError if field is missing or not a string
 */
export function requireString(body: unknown, field: string): string {
	const b = body as Record<string, unknown>;
	if (typeof b[field] !== "string") {
		throw new ValidationError(`Missing or invalid ${field}`);
	}
	return b[field] as string;
}
