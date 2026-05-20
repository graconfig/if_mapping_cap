import { runStep1 } from '../../srv/matching/step1-custom-fields.js';
import type {
  InterfaceFieldInput,
  Step1Result,
} from '../../srv/matching/step1-custom-fields.js';
import type { HanaRepository, CustomField } from '../../srv/repository/hana-repository.js';
import type { AiCoreClient } from '../../srv/ai/aicore-client.js';
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

function makeCustomField(overrides: Partial<CustomField> = {}): CustomField {
  return {
    id:          'uuid-1',
    ifName:      'IF_MM_001',
    sourceTable: 'EKKO',
    sourceField: 'EBELN',
    sourceDesc:  '購買伝票番号',
    targetTable: 'C_PurchaseOrderTP',
    targetField: 'PurchaseOrder',
    targetDesc:  'Purchase Order',
    notes:       'Verified mapping',
    score:       undefined,
    ...overrides,
  };
}

function makeMockHana(
  exactResult:  CustomField | null,
  vectorResult: CustomField[] = []
): jest.Mocked<Pick<HanaRepository, 'getExactCustomField' | 'getVectorCustomFields'>> {
  return {
    getExactCustomField:  jest.fn().mockResolvedValue(exactResult),
    getVectorCustomFields: jest.fn().mockResolvedValue(vectorResult),
  } as any;
}

function makeMockAiCore(embeddings: number[][] = [[0.1, 0.2]]): jest.Mocked<Pick<AiCoreClient, 'generateEmbeddings'>> {
  return {
    generateEmbeddings: jest.fn().mockResolvedValue(embeddings),
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

test('exact match found → field in matched[], matchSource=exact, score=1.0', async () => {
  const field = makeField({ rowIndex: 1 });
  const cf    = makeCustomField();
  const hana  = makeMockHana(cf);
  const ai    = makeMockAiCore();

  const result: Step1Result = await runStep1([field], hana as any, ai as any, defaultConfig);

  expect(result.matched).toHaveLength(1);
  expect(result.unmatched).toHaveLength(0);
  expect(result.matched[0].matchSource).toBe('exact');
  expect(result.matched[0].matchScore).toBe(1.0);
  expect(result.matched[0].rowIndex).toBe(1);
  expect(result.matched[0].tableId).toBe('C_PurchaseOrderTP');
  expect(result.matched[0].fieldId).toBe('PurchaseOrder');
  expect(result.matched[0].verified).toBe(false);
  expect(ai.generateEmbeddings).not.toHaveBeenCalled();
});

test('no exact match but vector match found → field in matched[], matchSource=vector', async () => {
  const field   = makeField({ rowIndex: 2 });
  const cf      = makeCustomField({ score: 0.88 });
  const hana    = makeMockHana(null, [cf]);
  const ai      = makeMockAiCore([[0.1, 0.2, 0.3]]);

  const result: Step1Result = await runStep1([field], hana as any, ai as any, defaultConfig);

  expect(result.matched).toHaveLength(1);
  expect(result.unmatched).toHaveLength(0);
  expect(result.matched[0].matchSource).toBe('vector');
  expect(result.matched[0].matchScore).toBe(0.88);
  expect(ai.generateEmbeddings).toHaveBeenCalledWith(['購買伝票番号 EBELN']);
  expect(hana.getVectorCustomFields).toHaveBeenCalledWith(
    [0.1, 0.2, 0.3],
    defaultConfig.vectorThreshold
  );
});

test('no exact or vector match → field in unmatched[]', async () => {
  const field = makeField({ rowIndex: 3 });
  const hana  = makeMockHana(null, []);
  const ai    = makeMockAiCore([[0.5, 0.6]]);

  const result: Step1Result = await runStep1([field], hana as any, ai as any, defaultConfig);

  expect(result.matched).toHaveLength(0);
  expect(result.unmatched).toHaveLength(1);
  expect(result.unmatched[0].rowIndex).toBe(3);
});

test('mixed: some exact, some vector, some unmatched', async () => {
  const fieldExact   = makeField({ rowIndex: 1, fieldName: 'EBELN' });
  const fieldVector  = makeField({ rowIndex: 2, fieldName: 'LIFNR', fieldText: 'Vendor' });
  const fieldNone    = makeField({ rowIndex: 3, fieldName: 'ZZCUSTOM', fieldText: 'Custom' });

  const cfExact  = makeCustomField({ sourceField: 'EBELN', targetField: 'PurchaseOrder' });
  const cfVector = makeCustomField({ sourceField: 'LIFNR', targetField: 'Supplier', score: 0.82 });

  const hana = {
    getExactCustomField: jest.fn()
      .mockResolvedValueOnce(cfExact)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null),
    getVectorCustomFields: jest.fn()
      .mockResolvedValueOnce([cfVector])
      .mockResolvedValueOnce([]),
  } as any;

  const ai = makeMockAiCore([[0.1, 0.2], [0.3, 0.4]]);

  const result: Step1Result = await runStep1(
    [fieldExact, fieldVector, fieldNone],
    hana,
    ai as any,
    defaultConfig
  );

  expect(result.matched).toHaveLength(2);
  expect(result.unmatched).toHaveLength(1);

  const exactResult  = result.matched.find(m => m.matchSource === 'exact');
  const vectorResult = result.matched.find(m => m.matchSource === 'vector');

  expect(exactResult?.rowIndex).toBe(1);
  expect(exactResult?.matchScore).toBe(1.0);
  expect(vectorResult?.rowIndex).toBe(2);
  expect(vectorResult?.matchScore).toBe(0.82);
  expect(result.unmatched[0].rowIndex).toBe(3);

  expect(ai.generateEmbeddings).toHaveBeenCalledWith([
    'Vendor LIFNR',
    'Custom ZZCUSTOM',
  ]);
});

test('empty input → returns empty matched and unmatched', async () => {
  const hana = makeMockHana(null);
  const ai   = makeMockAiCore();

  const result: Step1Result = await runStep1([], hana as any, ai as any, defaultConfig);

  expect(result.matched).toHaveLength(0);
  expect(result.unmatched).toHaveLength(0);
  expect(hana.getExactCustomField).not.toHaveBeenCalled();
  expect(ai.generateEmbeddings).not.toHaveBeenCalled();
});

test('vector match score defaults to 0 when score is undefined', async () => {
  const field = makeField({ rowIndex: 5 });
  const cf    = makeCustomField({ score: undefined });
  const hana  = makeMockHana(null, [cf]);
  const ai    = makeMockAiCore([[0.1, 0.2]]);

  const result: Step1Result = await runStep1([field], hana as any, ai as any, defaultConfig);

  expect(result.matched[0].matchScore).toBe(0);
  expect(result.matched[0].matchSource).toBe('vector');
});

test('correlationId is forwarded to logger', async () => {
  const field = makeField();
  const hana  = makeMockHana(makeCustomField());
  const ai    = makeMockAiCore();

  await runStep1([field], hana as any, ai as any, defaultConfig, 'corr-123');

  expect(log.info).toHaveBeenCalledWith(
    'Step1 complete',
    expect.objectContaining({ correlationId: 'corr-123' })
  );
});
