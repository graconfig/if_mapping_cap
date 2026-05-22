import { runStep1 } from '../../srv/matching/step1-custom-fields.js';
import type { InterfaceFieldInput } from '../../@cds-models/index.js';
import type { Step1Result } from '../../srv/matching/step1-custom-fields.js';
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
    ID:               'uuid-1',
    scenario:         '',
    ifName:           'IF_MM_001',
    sourceTable:      'EKKO',
    sourceField:      'EBELN',
    sourceDesc:       '購買伝票番号',
    sourceType:       '',
    sourceLength:     null,
    sourceDecimals:   null,
    targetTable:      'C_PurchaseOrderTP',
    targetField:      'PurchaseOrder',
    targetDesc:       'Purchase Order',
    targetType:       '',
    targetLength:     null,
    targetDecimals:   null,
    keyFlag:          '',
    obligatory:       '',
    allowedValues:    '',
    allowedValuesDesc: '',
    class1:           '',
    class2:           '',
    class3:           '',
    isAppend:         '',
    notes:            'Verified mapping',
    color:            '',
    score:            undefined,
    ...overrides,
  };
}

function makeMockHana(
  exactResult:  { result: CustomField | null; isMultiple: boolean },
  vectorResult: CustomField[] = []
): jest.Mocked<Pick<HanaRepository, 'getExactCustomField' | 'getVectorCustomFields'>> {
  return {
    getExactCustomField:   jest.fn().mockResolvedValue(exactResult),
    getVectorCustomFields: jest.fn().mockResolvedValue(vectorResult),
  } as any;
}

const noopAi = {} as jest.Mocked<AiCoreClient>;

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
  const field = makeField({ rowIndex: 1, tableId: 'EKKO', fieldId: 'EBELN' });
  const cf    = makeCustomField();
  const hana  = makeMockHana({ result: cf, isMultiple: false });

  const result: Step1Result = await runStep1([field], hana as any, noopAi, defaultConfig);

  expect(result.matched).toHaveLength(1);
  expect(result.unmatched).toHaveLength(0);
  expect(result.matched[0].matchSource).toBe('exact');
  expect(result.matched[0].matchScore).toBe(1.0);
  expect(result.matched[0].rowIndex).toBe(1);
  expect(result.matched[0].tableId).toBe('C_PurchaseOrderTP');
  expect(result.matched[0].fieldId).toBe('PurchaseOrder');
  expect(result.matched[0].verified).toBe(false);
  expect(hana.getVectorCustomFields).not.toHaveBeenCalled();
});

test('no exact match but vector match found → field in matched[], matchSource=vector', async () => {
  const field = makeField({ rowIndex: 2, tableId: 'EKKO', fieldId: 'EBELN' });
  const cf    = makeCustomField({ score: 0.88 });
  const hana  = makeMockHana({ result: null, isMultiple: false }, [cf]);

  const result: Step1Result = await runStep1([field], hana as any, noopAi, defaultConfig);

  expect(result.matched).toHaveLength(1);
  expect(result.unmatched).toHaveLength(0);
  expect(result.matched[0].matchSource).toBe('vector');
  expect(result.matched[0].matchScore).toBe(0.88);
  expect(hana.getVectorCustomFields).toHaveBeenCalledWith(
    'IF_MM_001 EKKO EBELN EBELN',
    defaultConfig.vectorThreshold,
    5,
    undefined,
    undefined
  );
});

test('isMultiple → vector search with scope filter', async () => {
  const field = makeField({ rowIndex: 2, tableId: 'EKKO', fieldId: 'EBELN' });
  const cf    = makeCustomField({ score: 0.90 });
  const hana  = makeMockHana({ result: null, isMultiple: true }, [cf]);

  const result: Step1Result = await runStep1([field], hana as any, noopAi, defaultConfig);

  expect(result.matched[0].matchSource).toBe('vector');
  expect(hana.getVectorCustomFields).toHaveBeenCalledWith(
    'IF_MM_001 EKKO EBELN EBELN',
    defaultConfig.vectorThreshold,
    5,
    'EKKO',
    'EBELN'
  );
});

test('no exact or vector match → field in unmatched[]', async () => {
  const field = makeField({ rowIndex: 3, tableId: 'EKKO', fieldId: 'EBELN' });
  const hana  = makeMockHana({ result: null, isMultiple: false }, []);

  const result: Step1Result = await runStep1([field], hana as any, noopAi, defaultConfig);

  expect(result.matched).toHaveLength(0);
  expect(result.unmatched).toHaveLength(1);
  expect(result.unmatched[0].rowIndex).toBe(3);
});

test('field without tableId/fieldId → skips exact match, goes directly to vector', async () => {
  const field = makeField({ rowIndex: 4 });
  const cf    = makeCustomField({ score: 0.80 });
  const hana  = makeMockHana({ result: null, isMultiple: false }, [cf]);

  const result: Step1Result = await runStep1([field], hana as any, noopAi, defaultConfig);

  expect(hana.getExactCustomField).not.toHaveBeenCalled();
  expect(result.matched[0].matchSource).toBe('vector');
  expect(hana.getVectorCustomFields).toHaveBeenCalledWith(
    'IF_MM_001 EBELN',
    defaultConfig.vectorThreshold,
    5,
    undefined,
    undefined
  );
});

test('mixed: some exact, some vector, some unmatched', async () => {
  const fieldExact  = makeField({ rowIndex: 1, tableId: 'EKKO',  fieldId: 'EBELN',    fieldName: 'EBELN' });
  const fieldVector = makeField({ rowIndex: 2, tableId: 'EKKO',  fieldId: 'LIFNR',    fieldName: 'LIFNR',   fieldText: 'Vendor' });
  const fieldNone   = makeField({ rowIndex: 3, tableId: 'EKKO',  fieldId: 'ZZCUSTOM', fieldName: 'ZZCUSTOM', fieldText: 'Custom' });

  const cfExact  = makeCustomField({ sourceField: 'EBELN', targetField: 'PurchaseOrder' });
  const cfVector = makeCustomField({ sourceField: 'LIFNR', targetField: 'Supplier', score: 0.82 });

  const hana = {
    getExactCustomField: jest.fn()
      .mockResolvedValueOnce({ result: cfExact,  isMultiple: false })
      .mockResolvedValueOnce({ result: null,     isMultiple: false })
      .mockResolvedValueOnce({ result: null,     isMultiple: false }),
    getVectorCustomFields: jest.fn()
      .mockResolvedValueOnce([cfVector])
      .mockResolvedValueOnce([]),
  } as any;

  const result: Step1Result = await runStep1(
    [fieldExact, fieldVector, fieldNone],
    hana,
    noopAi,
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
});

test('empty input → returns empty matched and unmatched', async () => {
  const hana = makeMockHana({ result: null, isMultiple: false });

  const result: Step1Result = await runStep1([], hana as any, noopAi, defaultConfig);

  expect(result.matched).toHaveLength(0);
  expect(result.unmatched).toHaveLength(0);
  expect(hana.getExactCustomField).not.toHaveBeenCalled();
});

test('vector match score defaults to 0 when score is undefined', async () => {
  const field = makeField({ rowIndex: 5, tableId: 'EKKO', fieldId: 'EBELN' });
  const cf    = makeCustomField({ score: undefined });
  const hana  = makeMockHana({ result: null, isMultiple: false }, [cf]);

  const result: Step1Result = await runStep1([field], hana as any, noopAi, defaultConfig);

  expect(result.matched[0].matchScore).toBe(0);
  expect(result.matched[0].matchSource).toBe('vector');
});

test('correlationId is forwarded to logger', async () => {
  const field = makeField({ tableId: 'EKKO', fieldId: 'EBELN' });
  const hana  = makeMockHana({ result: makeCustomField(), isMultiple: false });

  await runStep1([field], hana as any, noopAi, defaultConfig, 'corr-123');

  expect(log.info).toHaveBeenCalledWith(
    'Step1 complete',
    expect.objectContaining({ correlationId: 'corr-123' })
  );
});
