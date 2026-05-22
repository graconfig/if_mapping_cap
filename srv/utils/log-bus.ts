import { EventEmitter } from 'events';

export interface LogEntry {
  level:    'info' | 'warn' | 'error' | 'debug';
  message:  string;
  context?: Record<string, unknown>;
  timestamp: string;
}

class LogBus extends EventEmitter {
  push(correlationId: string, entry: LogEntry): void {
    this.emit(correlationId, entry);
  }
}

export const logBus = new LogBus();
logBus.setMaxListeners(100);
