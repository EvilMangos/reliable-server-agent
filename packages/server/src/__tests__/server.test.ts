import { describe, it } from 'vitest';

describe('Control Server', () => {
  describe('POST /commands', () => {
    it.todo('should create a new DELAY command');
    it.todo('should create a new HTTP_GET_JSON command');
    it.todo('should return commandId in response');
    it.todo('should reject invalid command type');
    it.todo('should reject missing payload');
  });

  describe('GET /commands/:id', () => {
    it.todo('should return command status and details');
    it.todo('should return 404 for non-existent command');
    it.todo('should include result when command is completed');
    it.todo('should include agentId when command is assigned');
  });

  describe('Command Assignment', () => {
    it.todo('should assign one command at a time to agent');
    it.todo('should mark command as RUNNING when assigned');
    it.todo('should prevent duplicate command execution');
  });

  describe('Persistence', () => {
    it.todo('should persist command state to storage');
    it.todo('should restore state on server restart');
  });

  describe('Crash Recovery', () => {
    it.todo('should detect leftover RUNNING commands on startup');
    it.todo('should handle unfinished commands deterministically');
  });
});
