import { runMatching } from '../../srv/matching/orchestrator.js';
import type { OrchestratorDeps } from '../../srv/matching/orchestrator.js';
import type { InterfaceFieldInput, MatchedFieldResult } from '../../@cds-models/index.js';
import type { RequestConfig } from '../../srv/utils/config.js';
import { log } from '../../srv/utils/logger.js';

jest.mock('../../srv/utils/logger.js', () => ({
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../../srv/matching/step1-custom-fields.js', () => ({
  runStep1: jest.fn(),
}));

jest.mock('../../srv/matching/step2-view-selection.js', () => ({
  runStep2: jest.fn(),
}));

jest.mock('../../srv/matching/step3-field-matching.js', () => ({
  runStep3: jest.fn(),
}));

jest.mock('../../srv/matching/step4-odata-verify.js', () => ({
  runStep4: jest.fn(),
}));

import { runStep1 } from '../../srv/matching/step1-custom-fields.js';
import { runStep2 } from '../../srv/matching/step2-view-selection.js';
import { runStep3 } from '../../srv/matching/step3-field-matching.js';
import { runStep4 } from '../../srv/matching/step4-odata-verify.js';

const mockRunStep1 = runStep1 as jest.MockedFunction<typeof runStep1>;
const mockRunStep2 = runStep2 as jest.MockedFunction<typeof runStep2>;
const mockRunStep3 = runStep3 as jest.MockedFunction<typeof runStep3>;
const mockRunStep4 = runStep4 as jest.MockedFunction<typeof runStep4>;

function makeField(rowIndex: number): InterfaceFieldInput {
  return {
    rowIndex,
    module:      'MM',
    ifName:      'IF_MM_001',
    ifDesc:      'Purchase order',
    fieldName:   `FIELD${rowIndex}`,
    fieldText:   `Field ${rowIndex}`,
    sampleValue: '',
    remark:      '',
  };
}

function makeResult(rowIndex: number, source: MatchedFieldResult['matchSource'] = 'exact'): MatchedFieldResult {
  return {
    rowIndex,
    tableId:     'EKKO',
    fieldId:     `F${rowIndex}`,
    dataType:    'CHAR(10)',
    fieldText:   `Field ${rowIndex}`,
    matchScore:  0.9,
    matchSource: source,
    notes:       '',
    verified:    false,
  };
}

const mockGetTerminologyMappings = jest.fn().mockResolvedValue([]);

const deps: OrchestratorDeps = {
  hana:    { getTerminologyMappings: mockGetTerminologyMappings } as any,
  aiCore:  {} as any,
  prompts: {} as any,
};

const baseConfig: RequestConfig = {
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

test('full pipeline — step1 matches some, step2+3 match rest, step4 verifies → final sorted result', async () => {
  const fields = [makeField(1), makeField(2), makeField(3)];

  const step1Matched   = [makeResult(1)];
  const step1Unmatched = [makeField(2), makeField(3)];
  const step3Matched   = [makeResult(3, 'ai'), makeResult(2, 'ai')];
  const step4Results   = [
    { ...makeResult(1),       verified: true },
    { ...makeResult(2, 'ai'), verified: true },
    { ...makeResult(3, 'ai'), verified: true },
  ];

  mockRunStep1.mockResolvedValue({ matched: step1Matched, unmatched: step1Unmatched });
  mockRunStep2.mockResolvedValue({ selectedViews: ['VIEW_A', 'VIEW_B'] });
  mockRunStep3.mockResolvedValue({ matched: step3Matched });
  mockRunStep4.mockResolvedValue({ results: step4Results });

  const config = { ...baseConfig, verifyFlag: true };
  const result = await runMatching(fields, config, deps, 'corr-full');

  expect(mockRunStep1).toHaveBeenCalledWith(fields, deps.hana, deps.aiCore, config, 'corr-full');
  expect(mockRunStep2).toHaveBeenCalledWith(step1Unmatched, deps.hana, deps.aiCore, deps.prompts, config, 'corr-full', '');
  expect(mockRunStep3).toHaveBeenCalledWith(step1Unmatched, ['VIEW_A', 'VIEW_B'], deps.hana, deps.aiCore, deps.prompts, config, 'corr-full', '');
  expect(mockRunStep4).toHaveBeenCalledWith([...step1Matched, ...step3Matched], config, 'corr-full');

  expect(result).toHaveLength(3);
  expect(result[0].rowIndex).toBe(1);
  expect(result[1].rowIndex).toBe(2);
  expect(result[2].rowIndex).toBe(3);
  expect(result.every(r => r.verified)).toBe(true);

  expect(log.info).toHaveBeenCalledWith(
    'Orchestrator complete',
    expect.objectContaining({ correlationId: 'corr-full', total: 3 })
  );
});

test('all matched in step1 → step2 and step3 NOT called', async () => {
  const fields = [makeField(1), makeField(2)];

  mockRunStep1.mockResolvedValue({
    matched:   [makeResult(1), makeResult(2)],
    unmatched: [],
  });

  const result = await runMatching(fields, baseConfig, deps, 'corr-all-step1');

  expect(mockRunStep2).not.toHaveBeenCalled();
  expect(mockRunStep3).not.toHaveBeenCalled();
  expect(mockRunStep4).not.toHaveBeenCalled();

  expect(result).toHaveLength(2);
});

test('all matched in step1 with verifyFlag=true → step4 called, step2 and step3 NOT called', async () => {
  const step1Matched = [makeResult(2), makeResult(1)];
  const step4Results = [
    { ...makeResult(1), verified: true },
    { ...makeResult(2), verified: true },
  ];

  mockRunStep1.mockResolvedValue({ matched: step1Matched, unmatched: [] });
  mockRunStep4.mockResolvedValue({ results: step4Results });

  const config = { ...baseConfig, verifyFlag: true };
  const result = await runMatching([makeField(1), makeField(2)], config, deps);

  expect(mockRunStep2).not.toHaveBeenCalled();
  expect(mockRunStep3).not.toHaveBeenCalled();
  expect(mockRunStep4).toHaveBeenCalledWith(step1Matched, config, undefined);

  expect(result[0].rowIndex).toBe(1);
  expect(result[1].rowIndex).toBe(2);
});

test('verifyFlag=false → step4 not called', async () => {
  const fields = [makeField(1), makeField(2)];

  mockRunStep1.mockResolvedValue({
    matched:   [makeResult(1)],
    unmatched: [makeField(2)],
  });
  mockRunStep2.mockResolvedValue({ selectedViews: ['VIEW_X'] });
  mockRunStep3.mockResolvedValue({ matched: [makeResult(2, 'ai')] });

  const result = await runMatching(fields, baseConfig, deps);

  expect(mockRunStep4).not.toHaveBeenCalled();
  expect(result).toHaveLength(2);
  expect(result.every(r => r.verified === false)).toBe(true);
});

test('step2 returns empty views → step3 called with empty views, returns error results', async () => {
  const fields = [makeField(1), makeField(2)];

  const step1Unmatched = [makeField(1), makeField(2)];
  const errorResults   = [
    makeResult(1, 'error'),
    makeResult(2, 'error'),
  ];

  mockRunStep1.mockResolvedValue({ matched: [], unmatched: step1Unmatched });
  mockRunStep2.mockResolvedValue({ selectedViews: [] });
  mockRunStep3.mockResolvedValue({ matched: errorResults });

  const result = await runMatching(fields, baseConfig, deps, 'corr-empty-views');

  expect(mockRunStep2).toHaveBeenCalled();
  expect(mockRunStep3).toHaveBeenCalledWith(
    step1Unmatched,
    [],
    deps.hana,
    deps.aiCore,
    deps.prompts,
    baseConfig,
    'corr-empty-views',
    ''
  );

  expect(result).toHaveLength(2);
  expect(result.every(r => r.matchSource === 'error')).toBe(true);
});

test('results sorted by rowIndex when returned out of order', async () => {
  const fields = [makeField(3), makeField(1), makeField(2)];

  mockRunStep1.mockResolvedValue({
    matched:   [makeResult(3)],
    unmatched: [makeField(1), makeField(2)],
  });
  mockRunStep2.mockResolvedValue({ selectedViews: ['VIEW_A'] });
  mockRunStep3.mockResolvedValue({
    matched: [makeResult(2, 'ai'), makeResult(1, 'ai')],
  });

  const result = await runMatching(fields, baseConfig, deps);

  expect(result[0].rowIndex).toBe(1);
  expect(result[1].rowIndex).toBe(2);
  expect(result[2].rowIndex).toBe(3);
});

test('correlationId is forwarded to all steps', async () => {
  const fields = [makeField(1)];

  mockRunStep1.mockResolvedValue({ matched: [], unmatched: [makeField(1)] });
  mockRunStep2.mockResolvedValue({ selectedViews: ['VIEW_A'] });
  mockRunStep3.mockResolvedValue({ matched: [makeResult(1, 'ai')] });

  await runMatching(fields, baseConfig, deps, 'my-corr-id');

  expect(mockRunStep1).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(), expect.anything(), 'my-corr-id');
  expect(mockRunStep2).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(), expect.anything(), expect.anything(), 'my-corr-id', expect.anything());
  expect(mockRunStep3).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(), expect.anything(), expect.anything(), expect.anything(), 'my-corr-id', expect.anything());
});

test('step1 error propagates out of runMatching', async () => {
  mockRunStep1.mockRejectedValue(new Error('Step1 exploded'));

  await expect(runMatching([makeField(1)], baseConfig, deps)).rejects.toThrow('Step1 exploded');
});
