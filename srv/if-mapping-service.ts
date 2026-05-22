import cds from '@sap/cds';
import type { Request as ExpressRequest, Response as ExpressResponse } from 'express';
import { HanaRepository } from './repository/hana-repository.js';
import { AiCoreClient } from './ai/aicore-client.js';
import { promptManager } from './ai/prompt-manager.js';
import { runMatching, OrchestratorDeps } from './matching/orchestrator.js';
import type { InterfaceFieldInput } from '../@cds-models/index.js';
import { buildRequestConfig } from './utils/config.js';
import { AppError } from './utils/errors.js';
import { log } from './utils/logger.js';
import { logBus } from './utils/log-bus.js';
import type { LogEntry } from './utils/log-bus.js';

const hana   = new HanaRepository();
const aiCore = new AiCoreClient();
const deps: OrchestratorDeps = { hana, aiCore, prompts: promptManager };

// SSE log stream — clients subscribe with ?correlationId=<id>
// Uses 'served' (not 'bootstrap') because service files are loaded after bootstrap fires.
cds.on('served', () => {
  const app = (cds as any).app;
  app.get('/log-stream', (req: ExpressRequest, res: ExpressResponse) => {
    const correlationId = req.query['correlationId'] as string | undefined;
    if (!correlationId) {
      res.status(400).end('correlationId required');
      return;
    }
    res.setHeader('Content-Type',  'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection',    'keep-alive');
    res.flushHeaders();

    const onLog = (entry: LogEntry) => {
      res.write(`data: ${JSON.stringify(entry)}\n\n`);
    };
    logBus.on(correlationId, onLog);
    req.on('close', () => logBus.off(correlationId, onLog));
  });
});

cds.on('shutdown', async () => {
  await hana.disconnect();
});

module.exports = class IfMappingService extends cds.ApplicationService {
  async init() {
    await super.init();
    await hana.connect();
    await promptManager.initialize();
    log.info('Service bootstrapped');

    this.on('match', async (req) => {
      const { fields, provider, language } = req.data as {
        fields:    InterfaceFieldInput[];
        provider?: string;
        language?: string;
      };
      const config = buildRequestConfig(provider ?? 'claude', language ?? 'ja');
      const correlationId = (req as any).headers?.['x-correlation-id'] as string | undefined;

      try {
        const results = await runMatching(fields, config, deps, correlationId);
        return results;
      } catch (err) {
        log.error('match action failed', { correlationId, error: String(err) });
        if (err instanceof AppError) {
          return req.error(err.statusCode, err.message);
        }
        return req.error(500, 'Internal server error');
      }
    });

    this.on('uploadCustomFields', async (req) => {
      const { records, mode } = req.data as {
        records: import('./repository/hana-repository.js').CustomFieldRecord[];
        mode?:   string;
      };
      try {
        const result = mode === 'overwrite'
          ? await hana.overwriteCustomFields(records)
          : await hana.upsertCustomFields(records);
        return result;
      } catch (err) {
        log.error('uploadCustomFields failed', { error: String(err) });
        return req.error(500, 'Upload failed');
      }
    });

    this.on('reloadPrompts', async (_req) => {
      await promptManager.reload();
      return { success: true };
    });
  }
};
