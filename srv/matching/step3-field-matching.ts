import type { InterfaceFieldInput, MatchedFieldResult } from '../../@cds-models/index.js';
import type { AiCoreClient } from '../ai/aicore-client.js';
import type { PromptManager } from '../ai/prompt-manager.js';
import type { HanaRepository, ViewField } from '../repository/hana-repository.js';
import type { RequestConfig } from '../utils/config.js';
import { log } from '../utils/logger.js';
import { trackTokens } from '../utils/token-tracker.js';

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
  row_index:     number;
  table_id:      string;
  field_id:      string;
  field_desc?:   string;
  data_type?:    string;
  length_total?: string;
  length_dec?:   string;
  key_flag?:     string;
  match?:        string;
  obligatory?:   string;
  sample_value?: string;
  notes?:        string;
}

export async function runStep3(
  unmatched:          InterfaceFieldInput[],
  selectedViews:      string[],
  hana:               HanaRepository,
  aiCore:             AiCoreClient,
  prompts:            PromptManager,
  config:             RequestConfig,
  correlationId?:     string,
  terminologyText?:   string,
  manualFieldsText?:  string
): Promise<Step3Result> {
  const viewFields: ViewField[] = await hana.getViewFields(selectedViews);

  if (viewFields.length === 0) {
    log.warn('Step3: no view fields available', { correlationId });
    const errorResults: MatchedFieldResult[] = unmatched.map(f => ({
      rowIndex:    f.rowIndex ?? 0,
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

  const userTemplate  = prompts.getPrompt('field_matching', config.language, 'user');
  const toolSchemaRaw = prompts.getPrompt('field_matching', config.language, 'tool_schema');
  const toolSchema    = JSON.parse(toolSchemaRaw);

  const tasks = batches.map((batch, batchIndex) => async (): Promise<MatchedFieldResult[]> => {
    try {
      const fieldsText = batch
        .map(f => `${f.rowIndex};${f.fieldName};${f.fieldText};;;;`)
        .join('\n');
      const contextText = viewFields
        .map(vf => `${vf.tableId};${vf.fieldId};;${vf.fieldText};${vf.dataType};;`)
        .join('\n');

      const userPrompt = fillTemplate(userTemplate, {
        fields:        fieldsText,
        manual_fields: manualFieldsText ?? '',
        context:       contextText,
        context_count: String(viewFields.length),
        match_number:  String(config.matchNumber),
        terminology:   terminologyText ?? '',
      });

      const result = await aiCore.callWithTools(
        [
          { role: 'user', content: userPrompt },
        ],
        [toolSchema],
        config.provider,
        config.llmModel
      );

      void trackTokens({
        requestId:    correlationId ?? 'unknown',
        provider:     config.provider as 'claude' | 'openai' | 'gemini',
        step:         'field_matching',
        inputTokens:  result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
      });

      const toolInput = result.toolInput as { review?: LlmMatchResult[] };
      const llmResults: LlmMatchResult[] = toolInput.review ?? [];

      return llmResults.map(r => {
        const vf = viewFieldIndex.get(`${r.table_id?.split('\n')[0].trim()}::${r.field_id?.split('\n')[0].trim()}`);

        const tableLines = (r.table_id ?? '').split('\n').map(s => s.trim()).filter(Boolean);
        const fieldLines = (r.field_id ?? '').split('\n').map(s => s.trim()).filter(Boolean);
        const lineCount  = Math.max(tableLines.length, fieldLines.length);
        const keyFlagParts:    string[] = [];
        const obligatoryParts: string[] = [];
        for (let i = 0; i < lineCount; i++) {
          const entry = viewFieldIndex.get(`${tableLines[i] ?? ''}::${fieldLines[i] ?? ''}`);
          keyFlagParts.push(entry?.isKey ? '○' : '');
          obligatoryParts.push(entry?.isKey ? '必須' : '任意');
        }

        return {
          rowIndex:    r.row_index,
          tableId:     r.table_id    ?? '',
          fieldId:     r.field_id    ?? '',
          dataType:    r.data_type   ?? vf?.dataType  ?? '',
          fieldText:   r.field_desc  ?? vf?.fieldText ?? '',
          matchScore:  r.match ? parseFloat(r.match) / 100 : 0,
          matchSource: 'ai' as const,
          notes:       r.notes       ?? '',
          verified:    false,
          keyFlag:     lineCount > 0 ? keyFlagParts.join('\n')    : (r.key_flag    || undefined),
          obligatory:  lineCount > 0 ? obligatoryParts.join('\n') : (r.obligatory  || undefined),
          sampleValue: r.sample_value || undefined,
          lengthTotal: r.length_total || undefined,
          lengthDec:   r.length_dec   || undefined,
        };
      });
    } catch (err) {
      log.warn('Step3: batch LLM call failed', {
        correlationId,
        batchIndex,
        error: String(err),
      });
      return batch.map(f => ({
        rowIndex:    f.rowIndex ?? 0,
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
