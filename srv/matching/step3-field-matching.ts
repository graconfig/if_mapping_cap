import type { InterfaceFieldInput, MatchedFieldResult } from './step1-custom-fields.js';
import type { HanaRepository, ViewField } from '../repository/hana-repository.js';
import type { AiCoreClient } from '../ai/aicore-client.js';
import type { PromptManager } from '../ai/prompt-manager.js';
import type { RequestConfig } from '../utils/config.js';
import { log } from '../utils/logger.js';

export interface Step3Result {
  matched: MatchedFieldResult[];
}

function fillTemplate(template: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce((acc, [k, v]) => acc.replaceAll(`{${k}}`, v), template);
}

async function runWithConcurrency<T>(
  tasks: (() => Promise<T>)[],
  maxConcurrency: number
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < tasks.length) {
      const index = nextIndex++;
      results[index] = await tasks[index]();
    }
  }

  const workers = Array.from(
    { length: Math.min(maxConcurrency, tasks.length) },
    () => worker()
  );
  await Promise.all(workers);
  return results;
}

interface LlmMatchResult {
  rowIndex: number;
  tableId:  string;
  fieldId:  string;
  fieldText?: string;
  score?:    number;
  notes?:    string;
}

export async function runStep3(
  unmatched:      InterfaceFieldInput[],
  selectedViews:  string[],
  hana:           HanaRepository,
  aiCore:         AiCoreClient,
  prompts:        PromptManager,
  config:         RequestConfig,
  correlationId?: string
): Promise<Step3Result> {
  const viewFields: ViewField[] = await hana.getViewFields(selectedViews);

  if (viewFields.length === 0) {
    log.warn('Step3: no view fields available', { correlationId });
    const errorResults: MatchedFieldResult[] = unmatched.map(f => ({
      rowIndex:    f.rowIndex,
      tableId:     '',
      fieldId:     '',
      dataType:    '',
      fieldText:   '',
      matchScore:  0,
      matchSource: 'error' as const,
      notes:       'No view fields available',
      verified:    false,
    }));
    return { matched: errorResults };
  }

  const viewFieldIndex = new Map<string, ViewField>();
  for (const vf of viewFields) {
    viewFieldIndex.set(`${vf.tableId}::${vf.fieldId}`, vf);
  }

  const batchSize = config.batchSize > 0 ? config.batchSize : 30;
  const batches: InterfaceFieldInput[][] = [];
  for (let i = 0; i < unmatched.length; i += batchSize) {
    batches.push(unmatched.slice(i, i + batchSize));
  }

  const systemPrompt  = prompts.getPrompt('field_matching', config.language, 'system');
  const userTemplate  = prompts.getPrompt('field_matching', config.language, 'user');
  const toolSchemaRaw = prompts.getPrompt('field_matching', config.language, 'tool_schema');
  const toolSchema    = JSON.parse(toolSchemaRaw);

  const tasks = batches.map((batch, batchIndex) => async (): Promise<MatchedFieldResult[]> => {
    try {
      const userPrompt = fillTemplate(userTemplate, {
        fields:     JSON.stringify(batch),
        viewFields: JSON.stringify(viewFields),
      });

      const result = await aiCore.callWithTools(
        [
          { role: 'user', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        [toolSchema],
        config.provider,
        config.llmModel
      );

      const toolInput = result.toolInput as { results?: LlmMatchResult[] };
      const llmResults: LlmMatchResult[] = toolInput.results ?? [];

      return llmResults.map(r => {
        const vf = viewFieldIndex.get(`${r.tableId}::${r.fieldId}`);
        return {
          rowIndex:    r.rowIndex,
          tableId:     r.tableId,
          fieldId:     r.fieldId,
          dataType:    vf?.dataType ?? '',
          fieldText:   r.fieldText ?? vf?.fieldText ?? '',
          matchScore:  r.score ?? 0,
          matchSource: 'ai' as const,
          notes:       r.notes ?? '',
          verified:    false,
        };
      });
    } catch (err) {
      log.warn('Step3: batch LLM call failed', {
        correlationId,
        batchIndex,
        error: String(err),
      });
      return batch.map(f => ({
        rowIndex:    f.rowIndex,
        tableId:     '',
        fieldId:     '',
        dataType:    '',
        fieldText:   '',
        matchScore:  0,
        matchSource: 'error' as const,
        notes:       String(err),
        verified:    false,
      }));
    }
  });

  const maxWorkers  = config.maxWorkers > 0 ? config.maxWorkers : 5;
  const batchArrays = await runWithConcurrency(tasks, maxWorkers);
  const matched     = batchArrays.flat();

  log.info('Step3 complete', { correlationId, matched: matched.length });
  return { matched };
}
