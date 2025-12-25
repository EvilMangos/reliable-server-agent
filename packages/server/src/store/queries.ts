export const QUERIES = {
	INSERT_COMMAND: `
		INSERT INTO commands (id, type, payloadJson, status, createdAt, attempt)
		VALUES (?, ?, ?, 'PENDING', ?, 0)
	`,
	SELECT_BY_ID: "SELECT * FROM commands WHERE id = ?",
	SELECT_OLDEST_PENDING: `
		SELECT * FROM commands
		WHERE status = 'PENDING'
		ORDER BY createdAt ASC
		LIMIT 1
	`,
	UPDATE_CLAIM: `
		UPDATE commands
		SET status = 'RUNNING',
			agentId = ?,
			leaseId = ?,
			leaseExpiresAt = ?,
			startedAt = ?,
			attempt = ?,
			scheduledEndAt = ?
		WHERE id = ?
	`,
	UPDATE_HEARTBEAT: `
		UPDATE commands
		SET leaseExpiresAt = ?
		WHERE id = ?
			AND status = 'RUNNING'
			AND agentId = ?
			AND leaseId = ?
	`,
	UPDATE_COMPLETE: `
		UPDATE commands
		SET status = 'COMPLETED',
			resultJson = ?,
			leaseExpiresAt = NULL
		WHERE id = ?
			AND status = 'RUNNING'
			AND agentId = ?
			AND leaseId = ?
	`,
	UPDATE_FAIL: `
		UPDATE commands
		SET status = 'FAILED',
			error = ?,
			resultJson = ?,
			leaseExpiresAt = NULL
		WHERE id = ?
			AND status = 'RUNNING'
			AND agentId = ?
			AND leaseId = ?
	`,
	RESET_EXPIRED_LEASES: `
		UPDATE commands
		SET status = 'PENDING',
			agentId = NULL,
			leaseId = NULL,
			leaseExpiresAt = NULL,
			startedAt = NULL,
			scheduledEndAt = NULL
		WHERE status = 'RUNNING'
			AND leaseExpiresAt IS NOT NULL
			AND leaseExpiresAt <= ?
	`,
} as const;
