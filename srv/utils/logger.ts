import cds from '@sap/cds';
import { logBus } from './log-bus.js';
import type { LogEntry } from './log-bus.js';

const _log = (cds as any).log('if-mapping');

function emit(level: LogEntry['level'], msg: string, ctx?: Record<string, unknown>): void {
  _log[level](msg, ctx);
  const cid = ctx?.correlationId;
  if (cid) {
    logBus.push(String(cid), {
      level,
      message:   msg,
      context:   ctx,
      timestamp: new Date().toISOString(),
    });
  }
}

export const log = {
  info:  (msg: string, ctx?: Record<string, unknown>) => emit('info',  msg, ctx),
  warn:  (msg: string, ctx?: Record<string, unknown>) => emit('warn',  msg, ctx),
  error: (msg: string, ctx?: Record<string, unknown>) => emit('error', msg, ctx),
  debug: (msg: string, ctx?: Record<string, unknown>) => emit('debug', msg, ctx),
};
