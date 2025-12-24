import { describe, it, expect } from 'vitest';
import type {
  Command,
  CommandStatus,
  CommandType,
  DelayPayload,
  HttpGetJsonPayload,
} from '../types/command.js';

describe('Command Types', () => {
  describe('CommandStatus', () => {
    it('should accept valid status values', () => {
      const statuses: CommandStatus[] = ['PENDING', 'RUNNING', 'COMPLETED', 'FAILED'];
      expect(statuses).toHaveLength(4);
    });
  });

  describe('CommandType', () => {
    it('should accept valid command types', () => {
      const types: CommandType[] = ['DELAY', 'HTTP_GET_JSON'];
      expect(types).toHaveLength(2);
    });
  });

  describe('Command', () => {
    it('should create a valid DELAY command', () => {
      const payload: DelayPayload = { ms: 1000 };
      const command: Command = {
        id: 'cmd-1',
        type: 'DELAY',
        payload,
        status: 'PENDING',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      expect(command.id).toBe('cmd-1');
      expect(command.type).toBe('DELAY');
      expect(command.status).toBe('PENDING');
      expect((command.payload as DelayPayload).ms).toBe(1000);
    });

    it('should create a valid HTTP_GET_JSON command', () => {
      const payload: HttpGetJsonPayload = { url: 'https://api.example.com/data' };
      const command: Command = {
        id: 'cmd-2',
        type: 'HTTP_GET_JSON',
        payload,
        status: 'PENDING',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      expect(command.id).toBe('cmd-2');
      expect(command.type).toBe('HTTP_GET_JSON');
      expect((command.payload as HttpGetJsonPayload).url).toBe('https://api.example.com/data');
    });

    it('should allow optional result and agentId', () => {
      const command: Command = {
        id: 'cmd-3',
        type: 'DELAY',
        payload: { ms: 500 },
        status: 'COMPLETED',
        result: { ok: true, tookMs: 502 },
        agentId: 'agent-1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      expect(command.result).toBeDefined();
      expect(command.agentId).toBe('agent-1');
    });
  });
});
