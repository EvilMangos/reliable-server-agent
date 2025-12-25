/**
 * Agent instance that processes commands from the server.
 */
export interface Agent {
	recoverFromJournal(): Promise<void>;
	runOneIteration(): Promise<void>;
	start(): Promise<void>;
	stop(): void;
}
