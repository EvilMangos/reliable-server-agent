import type { Logger } from "../types";
import { LOG_LEVELS, type LogLevel, getCurrentLevel } from "./log-level";

function formatTimestamp(): string {
	return new Date().toISOString();
}

export class LoggerImpl implements Logger {
	constructor(private readonly prefix: string) {}

	private log(level: LogLevel, message: string): void {
		if (LOG_LEVELS[level] >= LOG_LEVELS[getCurrentLevel()]) {
			const timestamp = formatTimestamp();
			const levelStr = level.toUpperCase().padEnd(5);
			console.log(`[${timestamp}] [${levelStr}] [${this.prefix}] ${message}`);
		}
	}

	debug(message: string): void {
		this.log("debug", message);
	}

	info(message: string): void {
		this.log("info", message);
	}

	warn(message: string): void {
		this.log("warn", message);
	}

	error(message: string): void {
		this.log("error", message);
	}
}

/**
 * Factory function for creating loggers.
 * @deprecated Use `new LoggerImpl(prefix)` instead.
 */
export function createLogger(prefix: string): Logger {
	return new LoggerImpl(prefix);
}
