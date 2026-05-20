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

import type { HanaRepository } from '../repository/hana-repository.js';
import type { AiCoreClient } from '../ai/aicore-client.js';
import type { PromptManager } from '../ai/prompt-manager.js';
import type { RequestConfig } from '../utils/config.js';
import { log } from '../utils/logger.js';
import { runStep1 } from './step1-custom-fields.js';
import type { InterfaceFieldInput, MatchedFieldResult } from './step1-custom-fields.js';
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
    log.info('Orchestrator complete', { correlationId, total: results.length });
    return results.slice().sort((a, b) => a.rowIndex - b.rowIndex);
  }

  const { selectedViews } = await runStep2(
    step1Unmatched,
    deps.hana,
    deps.aiCore,
    deps.prompts,
    config,
    correlationId
  );

  const { matched: step3Matched } = await runStep3(
    step1Unmatched,
    selectedViews,
    deps.hana,
    deps.aiCore,
    deps.prompts,
    config,
    correlationId
  );

  const allMatched: MatchedFieldResult[] = [...step1Matched, ...step3Matched];

  let results = allMatched;
  if (config.verifyFlag) {
    const step4 = await runStep4(allMatched, config, correlationId);
    results = step4.results;
  }

  log.info('Orchestrator complete', { correlationId, total: results.length });
  return results.slice().sort((a, b) => a.rowIndex - b.rowIndex);
}
