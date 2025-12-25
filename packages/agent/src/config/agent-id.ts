/**
 * Agent ID generation utilities.
 */

import { randomBytes } from "node:crypto";

export function generateAgentId(): string {
	return `agent-${randomBytes(4).toString("hex")}`;
}
