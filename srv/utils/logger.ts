import cds from '@sap/cds';

const _log = (cds as any).log('if-mapping');

export const log = {
  info:  (msg: string, ctx?: Record<string, unknown>) => _log.info(msg, ctx),
  warn:  (msg: string, ctx?: Record<string, unknown>) => _log.warn(msg, ctx),
  error: (msg: string, ctx?: Record<string, unknown>) => _log.error(msg, ctx),
  debug: (msg: string, ctx?: Record<string, unknown>) => _log.debug(msg, ctx),
};
