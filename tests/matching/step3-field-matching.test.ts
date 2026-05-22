import { runStep3 } from '../../srv/matching/step3-field-matching.js';
import type { Step3Result } from '../../srv/matching/step3-field-matching.js';
import type { InterfaceFieldInput, MatchedFieldResult } from '../../@cds-models/index.js';
import type { HanaRepository, ViewField } from '../../srv/repository/hana-repository.js';
import type { AiCoreClient, ToolResult } from '../../srv/ai/aicore-client.js';
import type { PromptManager } from '../../srv/ai/prompt-manager.js';
import type { RequestConfig } from '../../srv/utils/config.js';
import { log } from '../../srv/utils/logger.js';

jest.mock('../../srv/utils/logger.js', () => ({
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

function makeField(overrides: Partial<InterfaceFieldInput> = {}): InterfaceFieldInput {
  return {
    rowIndex:    1,
    module:      'MM',
    ifName:      'IF_MM_001',
    ifDesc:      'Purchase order interface',
    fieldName:   'EBELN',
    fieldText:   '購買伝票番号',
    sampleValue: '4500000001',
    remark:      '',
    ...overrides,
  };
}

function makeViewField(overrides: Partial<ViewField> = {}): ViewField {
  return {
    viewName:  'C_PurchaseOrderTP',
    fieldId:   'PurchaseOrder',
    tableId:   'EKKO',
    dataType:  'CHAR(10)',
    fieldText: 'Purchase Order Number',
    isKey:     false,
    ...overrides,
  };
}

const TOOL_SCHEMA_JSON = JSON.stringify({
  name:        'review_field_matches',
  description: 'Match input fields to CDS view fields',
  inputSchema: {
    type:       'object',
    properties: {
      review: {
        type:  'array',
        items: {
          type:       'object',
          properties: {
            row_index:  { type: 'integer' },
            table_id:   { type: 'string' },
            field_id:   { type: 'string' },
            field_desc: { type: 'string' },
            data_type:  { type: 'string' },
            match:      { type: 'string' },
            notes:      { type: 'string' },
          },
          required: ['row_index', 'table_id', 'field_id', 'match', 'notes'],
        },
      },
    },
    required: ['review'],
  },
});

function makeMockHana(viewFields: ViewField[]): jest.Mocked<Pick<HanaRepository, 'getViewFields'>> {
  return {
    getViewFields: jest.fn().mockResolvedValue(viewFields),
  } as any;
}

function makeMockAiCore(toolResult: ToolResult): jest.Mocked<Pick<AiCoreClient, 'callWithTools'>> {
  return {
    callWithTools: jest.fn().mockResolvedValue(toolResult),
  } as any;
}

function makeMockPrompts(
  userTemplate  = 'Fields: {fields}\nContext: {context}',
  toolSchemaRaw = TOOL_SCHEMA_JSON
): jest.Mocked<Pick<PromptManager, 'getPrompt'>> {
  return {
    getPrompt: jest.fn((_step, _lang, type) => {
      if (type === 'user')        return userTemplate;
      if (type === 'tool_schema') return toolSchemaRaw;
      return '';
    }),
  } as any;
}

const defaultConfig: RequestConfig = {
  provider:        'claude',
  language:        'ja',
  llmModel:        'anthropic--claude-4.5-sonnet',
  embedModel:      'text-embedding-ada-002',
  batchSize:       30,
  maxWorkers:      5,
  vectorThreshold: 0.75,
  matchNumber:     3,
  verifyFlag:      false,
};

beforeEach(() => {
  jest.clearAllMocks();
});

test('normal flow — LLM returns matched results → all fields mapped with matchSource=ai', async () => {
  const field     = makeField({ rowIndex: 1 });
  const viewField = makeViewField({ tableId: 'EKKO', fieldId: 'PurchaseOrder', dataType: 'CHAR(10)' });
  const hana      = makeMockHana([viewField]);
  const aiCore    = makeMockAiCore({
    toolName:  'review_field_matches',
    toolInput: {
      review: [
        { row_index: 1, table_id: 'EKKO', field_id: 'PurchaseOrder', match: '95', notes: 'Good match' },
      ],
    },
    usage: { inputTokens: 100, outputTokens: 50 },
  });
  const prompts = makeMockPrompts();

  const result: Step3Result = await runStep3(
    [field],
    ['C_PurchaseOrderTP'],
    hana as any,
    aiCore as any,
    prompts as any,
    defaultConfig
  );

  expect(result.matched).toHaveLength(1);
  const m = result.matched[0];
  expect(m.rowIndex).toBe(1);
  expect(m.tableId).toBe('EKKO');
  expect(m.fieldId).toBe('PurchaseOrder');
  expect(m.dataType).toBe('CHAR(10)');
  expect(m.matchScore).toBe(0.95);
  expect(m.matchSource).toBe('ai');
  expect(m.notes).toBe('Good match');
  expect(m.verified).toBe(false);
});

test('empty viewFields → returns error results for all unmatched fields', async () => {
  const fields  = [makeField({ rowIndex: 1 }), makeField({ rowIndex: 2, fieldName: 'LIFNR' })];
  const hana    = makeMockHana([]);
  const aiCore  = makeMockAiCore({ toolName: 'review_field_matches', toolInput: { review: [] }, usage: { inputTokens: 0, outputTokens: 0 } });
  const prompts = makeMockPrompts();

  const result: Step3Result = await runStep3(
    fields,
    ['C_PurchaseOrderTP'],
    hana as any,
    aiCore as any,
    prompts as any,
    defaultConfig
  );

  expect(result.matched).toHaveLength(2);
  expect(result.matched.every(m => m.matchSource === 'error')).toBe(true);
  expect(result.matched.every(m => m.notes === 'No view fields available')).toBe(true);
  expect(result.matched.every(m => m.matchScore === 0)).toBe(true);
  expect(result.matched.map(m => m.rowIndex)).toEqual([1, 2]);
  expect(aiCore.callWithTools).not.toHaveBeenCalled();
  expect(log.warn).toHaveBeenCalledWith(
    'Step3: no view fields available',
    expect.any(Object)
  );
});

test('LLM batch failure → batch marked as error, other batches still processed', async () => {
  const field1 = makeField({ rowIndex: 1 });
  const field2 = makeField({ rowIndex: 2, fieldName: 'LIFNR' });
  const viewField = makeViewField();
  const hana = makeMockHana([viewField]);

  const aiCore: jest.Mocked<Pick<AiCoreClient, 'callWithTools'>> = {
    callWithTools: jest.fn()
      .mockRejectedValueOnce(new Error('LLM timeout'))
      .mockResolvedValueOnce({
        toolName:  'review_field_matches',
        toolInput: { review: [{ row_index: 2, table_id: 'EKKO', field_id: 'PurchaseOrder', match: '80', notes: '' }] },
        usage:     { inputTokens: 50, outputTokens: 20 },
      }),
  } as any;

  const prompts = makeMockPrompts();
  const config: RequestConfig = { ...defaultConfig, batchSize: 1 };

  const result: Step3Result = await runStep3(
    [field1, field2],
    ['C_PurchaseOrderTP'],
    hana as any,
    aiCore as any,
    prompts as any,
    config
  );

  expect(result.matched).toHaveLength(2);

  const errorResult = result.matched.find(m => m.rowIndex === 1);
  expect(errorResult?.matchSource).toBe('error');
  expect(errorResult?.matchScore).toBe(0);

  const successResult = result.matched.find(m => m.rowIndex === 2);
  expect(successResult?.matchSource).toBe('ai');
  expect(successResult?.matchScore).toBe(0.8);

  expect(log.warn).toHaveBeenCalledWith(
    'Step3: batch LLM call failed',
    expect.objectContaining({ error: expect.stringContaining('LLM timeout') })
  );
});

test('batching — fields split correctly into batches of batchSize', async () => {
  const fields = Array.from({ length: 7 }, (_, i) =>
    makeField({ rowIndex: i + 1, fieldName: `FIELD${i + 1}` })
  );
  const viewField = makeViewField();
  const hana      = makeMockHana([viewField]);

  const callTracker: number[][] = [];
  const aiCore: jest.Mocked<Pick<AiCoreClient, 'callWithTools'>> = {
    callWithTools: jest.fn().mockImplementation((_messages, _tools, _provider, _model) => {
      const userMsg = _messages[0].content as string;
      const fieldLines = userMsg
        .replace('Fields: ', '')
        .split('\n')
        .filter(l => l.trim() && !l.startsWith('Context'));
      const rowIndices = fieldLines.map(l => parseInt(l.split(';')[0])).filter(n => !isNaN(n));
      callTracker.push(rowIndices);
      return Promise.resolve({
        toolName:  'review_field_matches',
        toolInput: { review: rowIndices.map(idx => ({ row_index: idx, table_id: 'EKKO', field_id: 'PurchaseOrder', match: '90', notes: '' })) },
        usage:     { inputTokens: 50, outputTokens: 20 },
      });
    }),
  } as any;

  const prompts = makeMockPrompts('Fields: {fields}\nContext: {context}');
  const config: RequestConfig = { ...defaultConfig, batchSize: 3, maxWorkers: 1 };

  const result: Step3Result = await runStep3(
    fields,
    ['C_PurchaseOrderTP'],
    hana as any,
    aiCore as any,
    prompts as any,
    config
  );

  expect(aiCore.callWithTools).toHaveBeenCalledTimes(3);
  expect(result.matched).toHaveLength(7);
});

test('concurrency — multiple batches processed with maxWorkers concurrency', async () => {
  const fields = Array.from({ length: 10 }, (_, i) =>
    makeField({ rowIndex: i + 1, fieldName: `FIELD${i + 1}` })
  );
  const viewField = makeViewField();
  const hana      = makeMockHana([viewField]);

  let concurrentCount = 0;
  let peakConcurrent  = 0;

  const aiCore: jest.Mocked<Pick<AiCoreClient, 'callWithTools'>> = {
    callWithTools: jest.fn().mockImplementation((_messages, _tools, _provider, _model) => {
      concurrentCount++;
      peakConcurrent = Math.max(peakConcurrent, concurrentCount);
      return new Promise(resolve => {
        setImmediate(() => {
          concurrentCount--;
          const fieldLines = (_messages[0].content as string)
            .replace('Fields: ', '')
            .split('\n')
            .filter((l: string) => l.trim() && !l.startsWith('Context'));
          const rowIndices = fieldLines.map((l: string) => parseInt(l.split(';')[0])).filter((n: number) => !isNaN(n));
          resolve({
            toolName:  'review_field_matches',
            toolInput: { review: rowIndices.map((idx: number) => ({ row_index: idx, table_id: 'EKKO', field_id: 'PurchaseOrder', match: '70', notes: '' })) },
            usage:     { inputTokens: 30, outputTokens: 10 },
          });
        });
      });
    }),
  } as any;

  const prompts = makeMockPrompts('Fields: {fields}\n{viewFields}');
  const config: RequestConfig = { ...defaultConfig, batchSize: 2, maxWorkers: 3 };

  const result: Step3Result = await runStep3(
    fields,
    ['C_PurchaseOrderTP'],
    hana as any,
    aiCore as any,
    prompts as any,
    config
  );

  expect(result.matched).toHaveLength(10);
  expect(peakConcurrent).toBeLessThanOrEqual(3);
  expect(aiCore.callWithTools).toHaveBeenCalledTimes(5);
});

test('empty input fields → returns empty matched', async () => {
  const hana    = makeMockHana([makeViewField()]);
  const aiCore  = makeMockAiCore({ toolName: 'review_field_matches', toolInput: { review: [] }, usage: { inputTokens: 0, outputTokens: 0 } });
  const prompts = makeMockPrompts();

  const result: Step3Result = await runStep3(
    [],
    ['C_PurchaseOrderTP'],
    hana as any,
    aiCore as any,
    prompts as any,
    defaultConfig
  );

  expect(result.matched).toHaveLength(0);
  expect(aiCore.callWithTools).not.toHaveBeenCalled();
  expect(log.info).toHaveBeenCalledWith(
    'Step3 complete',
    expect.objectContaining({ matched: 0 })
  );
});

test('dataType is looked up from viewFields by tableId+fieldId', async () => {
  const field     = makeField({ rowIndex: 1 });
  const viewField = makeViewField({ tableId: 'EKKO', fieldId: 'PurchaseOrder', dataType: 'NVARCHAR(10)' });
  const hana      = makeMockHana([viewField]);
  const aiCore    = makeMockAiCore({
    toolName:  'review_field_matches',
    toolInput: { review: [{ row_index: 1, table_id: 'EKKO', field_id: 'PurchaseOrder', match: '90', notes: '' }] },
    usage:     { inputTokens: 50, outputTokens: 20 },
  });
  const prompts = makeMockPrompts();

  const result: Step3Result = await runStep3(
    [field],
    ['C_PurchaseOrderTP'],
    hana as any,
    aiCore as any,
    prompts as any,
    defaultConfig
  );

  expect(result.matched[0].dataType).toBe('NVARCHAR(10)');
});

test('LLM result with unknown tableId+fieldId gets empty dataType', async () => {
  const field     = makeField({ rowIndex: 1 });
  const viewField = makeViewField({ tableId: 'EKKO', fieldId: 'PurchaseOrder' });
  const hana      = makeMockHana([viewField]);
  const aiCore    = makeMockAiCore({
    toolName:  'review_field_matches',
    toolInput: { review: [{ row_index: 1, table_id: 'UNKNOWN', field_id: 'NOFIELD', match: '30', notes: '' }] },
    usage:     { inputTokens: 50, outputTokens: 20 },
  });
  const prompts = makeMockPrompts();

  const result: Step3Result = await runStep3(
    [field],
    ['C_PurchaseOrderTP'],
    hana as any,
    aiCore as any,
    prompts as any,
    defaultConfig
  );

  expect(result.matched[0].dataType).toBe('');
});

test('correlationId is forwarded to logger on completion', async () => {
  const field     = makeField({ rowIndex: 1 });
  const viewField = makeViewField();
  const hana      = makeMockHana([viewField]);
  const aiCore    = makeMockAiCore({
    toolName:  'review_field_matches',
    toolInput: { review: [{ row_index: 1, table_id: 'EKKO', field_id: 'PurchaseOrder', match: '90', notes: '' }] },
    usage:     { inputTokens: 50, outputTokens: 20 },
  });
  const prompts = makeMockPrompts();

  await runStep3(
    [field],
    ['C_PurchaseOrderTP'],
    hana as any,
    aiCore as any,
    prompts as any,
    defaultConfig,
    'corr-abc'
  );

  expect(log.info).toHaveBeenCalledWith(
    'Step3 complete',
    expect.objectContaining({ correlationId: 'corr-abc' })
  );
});
