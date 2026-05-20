import cds from '@sap/cds';
import { HanaRepository } from './repository/hana-repository.js';
import { AiCoreClient } from './ai/aicore-client.js';
import { promptManager } from './ai/prompt-manager.js';
import { runMatching, OrchestratorDeps } from './matching/orchestrator.js';
import { buildRequestConfig } from './utils/config.js';
import { AppError } from './utils/errors.js';
import { log } from './utils/logger.js';

const hana   = new HanaRepository();
const aiCore = new AiCoreClient();
const deps: OrchestratorDeps = { hana, aiCore, prompts: promptManager };

cds.on('bootstrap', async () => {
  await hana.connect();
  await promptManager.initialize();
  log.info('Service bootstrapped');
});

module.exports = class IfMappingService extends cds.ApplicationService {
  async init() {
    await super.init();

    this.on('match', async (req) => {
      const { fields, provider, language } = req.data as {
        fields:    { sourceTable: string; sourceField: string; sourceDesc: string; rowIndex: number }[];
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
