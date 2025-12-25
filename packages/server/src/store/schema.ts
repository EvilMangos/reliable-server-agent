import { COMMAND_STATUS } from "@reliable-server-agent/shared";

export const SCHEMA = `
	CREATE TABLE IF NOT EXISTS commands (
		id TEXT PRIMARY KEY,
		type TEXT NOT NULL,
		payloadJson TEXT NOT NULL,
		status TEXT NOT NULL DEFAULT ${COMMAND_STATUS.PENDING},
		resultJson TEXT,
		error TEXT,
		agentId TEXT,
		leaseId TEXT,
		leaseExpiresAt INTEGER,
		createdAt INTEGER NOT NULL,
		startedAt INTEGER,
		attempt INTEGER NOT NULL DEFAULT 0,
		scheduledEndAt INTEGER
	);

	CREATE INDEX IF NOT EXISTS idx_commands_status ON commands(status);
	CREATE INDEX IF NOT EXISTS idx_commands_leaseExpiresAt ON commands(leaseExpiresAt);
	CREATE INDEX IF NOT EXISTS idx_commands_createdAt ON commands(createdAt);
`;
