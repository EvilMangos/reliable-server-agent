export interface Logger {
	debug(message: string): void;
	info(message: string): void;
	warn(message: string): void;
	error(message: string): void;
}

const LOG_LEVELS = {
	debug: 0,
	info: 1,
	warn: 2,
	error: 3,
} as const;

type LogLevel = keyof typeof LOG_LEVELS;

let currentLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || "info";

export function setLogLevel(level: LogLevel): void {
	currentLevel = level;
}

function formatTimestamp(): string {
	return new Date().toISOString();
}

export function createLogger(prefix: string): Logger {
	function log(level: LogLevel, message: string): void {
		if (LOG_LEVELS[level] >= LOG_LEVELS[currentLevel]) {
			const timestamp = formatTimestamp();
			const levelStr = level.toUpperCase().padEnd(5);
			console.log(`[${timestamp}] [${levelStr}] [${prefix}] ${message}`);
		}
	}

	return {
		debug: (message: string) => log("debug", message),
		info: (message: string) => log("info", message),
		warn: (message: string) => log("warn", message),
		error: (message: string) => log("error", message),
	};
}
