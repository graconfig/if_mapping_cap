export async function runInBatches<T, R>(
  items:       T[],
  batchSize:   number,
  concurrency: number,
  fn:          (batch: T[]) => Promise<R>
): Promise<R[]> {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize));
  }

  const results: R[] = [];
  for (let i = 0; i < batches.length; i += concurrency) {
    const chunk = batches.slice(i, i + concurrency);
    const chunkResults = await Promise.all(chunk.map(fn));
    results.push(...chunkResults);
  }
  return results;
}

import type { InterfaceFieldInput, MatchedFieldResult } from '../../@cds-models/index.js';
import type { AiCoreClient } from '../ai/aicore-client.js';
import type { PromptManager } from '../ai/prompt-manager.js';
import type { HanaRepository } from '../repository/hana-repository.js';
import type { RequestConfig } from '../utils/config.js';
import { log } from '../utils/logger.js';
import { t } from '../utils/i18n.js';
import { runStep1 } from './step1-custom-fields.js';
import { runStep2 } from './step2-view-selection.js';
import { runStep3 } from './step3-field-matching.js';
import { runStep4 } from './step4-odata-verify.js';

export interface OrchestratorDeps {
  hana:    HanaRepository;
  aiCore:  AiCoreClient;
  prompts: PromptManager;
}

export async function runMatching(
  fields:         InterfaceFieldInput[],
  config:         RequestConfig,
  deps:           OrchestratorDeps,
  correlationId?: string
): Promise<MatchedFieldResult[]> {
  const { matched: step1Matched, unmatched: step1Unmatched } = await runStep1(
    fields,
    deps.hana,
    deps.aiCore,
    config,
    correlationId
  );

  if (step1Unmatched.length === 0) {
    let results = step1Matched;
    if (config.verifyFlag) {
      const step4 = await runStep4(step1Matched, config, correlationId);
      results = step4.results;
    }
    log.info(t('log.orchestrator_complete', config.language), { correlationId, total: results.length });
    return results.slice().sort((a, b) => (a.rowIndex ?? 0) - (b.rowIndex ?? 0));
  }

  const terminologyRows = await deps.hana.getTerminologyMappings().catch(() => []);
  const terminologyText = terminologyRows
    .map(t => `${t.sourceTerm},${t.sourceTermAlias},${t.sourceContext},${t.targetTerm},${t.targetTermAlias},${t.sapModule},${t.sapTransaction},${t.sapObjectType},${t.sapTechnicalName},${t.category},${t.domainArea},${t.priority},${t.confidence}`)
    .join('\n');

  const { selectedViews } = await runStep2(
    step1Unmatched,
    deps.hana,
    deps.aiCore,
    deps.prompts,
    config,
    correlationId,
    terminologyText
  );

  const inputByRow = new Map(fields.map(f => [f.rowIndex ?? 0, f]));
  const manualFieldsText = step1Matched
    .map(m => {
      const f = inputByRow.get(m.rowIndex ?? 0);
      return `${m.rowIndex}:${f?.fieldName ?? ''};${f?.fieldText ?? ''};;${f?.dataType ?? ''};${f?.tableId ?? ''};${f?.fieldId ?? ''};;${m.tableId};${m.fieldId}`;
    })
    .join('\n');

  const { matched: step3Matched } = await runStep3(
    step1Unmatched,
    selectedViews,
    deps.hana,
    deps.aiCore,
    deps.prompts,
    config,
    correlationId,
    terminologyText,
    manualFieldsText
  );

  const allMatched: MatchedFieldResult[] = [...step1Matched, ...step3Matched];

  let results = allMatched;
  if (config.verifyFlag) {
    const step4 = await runStep4(allMatched, config, correlationId);
    results = step4.results;
  }

  log.info(t('log.orchestrator_complete', config.language), { correlationId, total: results.length });
  return results.slice().sort((a, b) => (a.rowIndex ?? 0) - (b.rowIndex ?? 0));
}
