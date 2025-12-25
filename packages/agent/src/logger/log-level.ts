export const LOG_LEVELS = {
	debug: 0,
	info: 1,
	warn: 2,
	error: 3,
	silent: 4,
} as const;

export type LogLevel = keyof typeof LOG_LEVELS;

let currentLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || "info";

export function setLogLevel(level: LogLevel): void {
	currentLevel = level;
}

export function getCurrentLevel(): LogLevel {
	return currentLevel;
}
