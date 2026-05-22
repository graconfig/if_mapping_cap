import { runStep4 } from '../../srv/matching/step4-odata-verify.js';
import type { Step4Result } from '../../srv/matching/step4-odata-verify.js';
import type { MatchedFieldResult } from '../../@cds-models/index.js';
import type { RequestConfig } from '../../srv/utils/config.js';
import { log } from '../../srv/utils/logger.js';

jest.mock('../../srv/utils/logger.js', () => ({
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const globalFetch = jest.fn();
global.fetch = globalFetch;

function makeResult(overrides: Partial<MatchedFieldResult> = {}): MatchedFieldResult {
  return {
    rowIndex:    1,
    tableId:     'EKKO',
    fieldId:     'PurchaseOrder',
    dataType:    'CHAR(10)',
    fieldText:   'Purchase Order Number',
    matchScore:  0.95,
    matchSource: 'exact',
    notes:       '',
    verified:    false,
    ...overrides,
  };
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
  verifyFlag:      true,
};

function makeCsrfResponse(token = 'csrf-token-abc'): Response {
  return {
    ok:      true,
    headers: { get: (name: string) => name === 'x-csrf-token' ? token : null },
  } as unknown as Response;
}

function makePostResponse(ok: boolean): Response {
  return { ok } as Response;
}

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.ODATA_URL;
  delete process.env.ODATA_USER;
  delete process.env.ODATA_PASSWORD;
});

test('verifyFlag=false → results returned unchanged, no fetch calls', async () => {
  const results  = [makeResult({ rowIndex: 1 }), makeResult({ rowIndex: 2 })];
  const config   = { ...defaultConfig, verifyFlag: false };

  const result: Step4Result = await runStep4(results, config, 'corr-1');

  expect(result.results).toBe(results);
  expect(globalFetch).not.toHaveBeenCalled();
});

test('no ODATA_URL → warn logged, results unchanged', async () => {
  const results = [makeResult()];

  const result: Step4Result = await runStep4(results, defaultConfig, 'corr-2');

  expect(result.results).toBe(results);
  expect(log.warn).toHaveBeenCalledWith(
    'Step4: ODATA_URL not set, skipping verification',
    expect.objectContaining({ correlationId: 'corr-2' })
  );
  expect(globalFetch).not.toHaveBeenCalled();
});

test('successful verification → verified=true for all non-error results', async () => {
  process.env.ODATA_URL      = 'https://example.com/odata';
  process.env.ODATA_USER     = 'user';
  process.env.ODATA_PASSWORD = 'pass';

  const results = [
    makeResult({ rowIndex: 1, tableId: 'EKKO', fieldId: 'PurchaseOrder' }),
    makeResult({ rowIndex: 2, tableId: 'EKPO', fieldId: 'PurchaseOrderItem', matchSource: 'vector' }),
  ];

  globalFetch
    .mockResolvedValueOnce(makeCsrfResponse('csrf-xyz'))
    .mockResolvedValueOnce(makePostResponse(true))
    .mockResolvedValueOnce(makePostResponse(true));

  const result: Step4Result = await runStep4(results, defaultConfig, 'corr-3');

  expect(result.results).toHaveLength(2);
  expect(result.results[0].verified).toBe(true);
  expect(result.results[1].verified).toBe(true);

  expect(globalFetch).toHaveBeenCalledTimes(3);
  expect(globalFetch).toHaveBeenNthCalledWith(1, 'https://example.com/odata', expect.objectContaining({
    method:  'GET',
    headers: expect.objectContaining({ 'X-CSRF-Token': 'Fetch' }),
  }));
  expect(globalFetch).toHaveBeenNthCalledWith(2, 'https://example.com/odata', expect.objectContaining({
    method:  'POST',
    headers: expect.objectContaining({ 'X-CSRF-Token': 'csrf-xyz' }),
    body:    JSON.stringify({ tableId: 'EKKO', fieldId: 'PurchaseOrder' }),
  }));

  expect(log.info).toHaveBeenCalledWith(
    'Step4 complete',
    expect.objectContaining({ correlationId: 'corr-3', verified: 2, skipped: 0 })
  );
});

test('individual POST failure → that result verified=false, others still processed', async () => {
  process.env.ODATA_URL      = 'https://example.com/odata';
  process.env.ODATA_USER     = 'user';
  process.env.ODATA_PASSWORD = 'pass';

  const results = [
    makeResult({ rowIndex: 1 }),
    makeResult({ rowIndex: 2, fieldId: 'ItemField' }),
  ];

  globalFetch
    .mockResolvedValueOnce(makeCsrfResponse())
    .mockResolvedValueOnce(makePostResponse(false))
    .mockResolvedValueOnce(makePostResponse(true));

  const result: Step4Result = await runStep4(results, defaultConfig, 'corr-4');

  expect(result.results[0].verified).toBe(false);
  expect(result.results[1].verified).toBe(true);

  expect(log.warn).toHaveBeenCalledWith(
    'Step4: POST verification failed',
    expect.objectContaining({ correlationId: 'corr-4', rowIndex: 1 })
  );
  expect(log.info).toHaveBeenCalledWith(
    'Step4 complete',
    expect.objectContaining({ verified: 1, skipped: 0 })
  );
});

test('CSRF fetch fails → log warn, return results unchanged', async () => {
  process.env.ODATA_URL      = 'https://example.com/odata';
  process.env.ODATA_USER     = 'user';
  process.env.ODATA_PASSWORD = 'pass';

  const results = [makeResult()];

  globalFetch.mockRejectedValueOnce(new Error('Network error'));

  const result: Step4Result = await runStep4(results, defaultConfig, 'corr-5');

  expect(result.results).toBe(results);
  expect(globalFetch).toHaveBeenCalledTimes(1);
  expect(log.warn).toHaveBeenCalledWith(
    'Step4: CSRF fetch failed, skipping verification',
    expect.objectContaining({ correlationId: 'corr-5', error: expect.stringContaining('Network error') })
  );
});

test('CSRF response missing token → warn logged, results unchanged', async () => {
  process.env.ODATA_URL      = 'https://example.com/odata';
  process.env.ODATA_USER     = 'user';
  process.env.ODATA_PASSWORD = 'pass';

  const results = [makeResult()];

  globalFetch.mockResolvedValueOnce({
    ok:      true,
    headers: { get: () => null },
  } as unknown as Response);

  const result: Step4Result = await runStep4(results, defaultConfig, 'corr-6');

  expect(result.results).toBe(results);
  expect(log.warn).toHaveBeenCalledWith(
    'Step4: CSRF token missing in response, skipping verification',
    expect.objectContaining({ correlationId: 'corr-6' })
  );
  expect(globalFetch).toHaveBeenCalledTimes(1);
});

test('error results (matchSource=error) → skipped, stay verified=false', async () => {
  process.env.ODATA_URL      = 'https://example.com/odata';
  process.env.ODATA_USER     = 'user';
  process.env.ODATA_PASSWORD = 'pass';

  const results = [
    makeResult({ rowIndex: 1, matchSource: 'error', verified: false }),
    makeResult({ rowIndex: 2, matchSource: 'exact', verified: false }),
    makeResult({ rowIndex: 3, matchSource: 'error', verified: false }),
  ];

  globalFetch
    .mockResolvedValueOnce(makeCsrfResponse())
    .mockResolvedValueOnce(makePostResponse(true));

  const result: Step4Result = await runStep4(results, defaultConfig, 'corr-7');

  expect(result.results[0].verified).toBe(false);
  expect(result.results[1].verified).toBe(true);
  expect(result.results[2].verified).toBe(false);

  expect(globalFetch).toHaveBeenCalledTimes(2);
  expect(log.info).toHaveBeenCalledWith(
    'Step4 complete',
    expect.objectContaining({ verified: 1, skipped: 2 })
  );
});

test('Authorization header uses correct Basic auth encoding', async () => {
  process.env.ODATA_URL      = 'https://example.com/odata';
  process.env.ODATA_USER     = 'myuser';
  process.env.ODATA_PASSWORD = 'mypass';

  const expectedAuth = `Basic ${Buffer.from('myuser:mypass').toString('base64')}`;

  globalFetch
    .mockResolvedValueOnce(makeCsrfResponse())
    .mockResolvedValueOnce(makePostResponse(true));

  await runStep4([makeResult()], defaultConfig);

  expect(globalFetch).toHaveBeenNthCalledWith(1, expect.any(String), expect.objectContaining({
    headers: expect.objectContaining({ Authorization: expectedAuth }),
  }));
  expect(globalFetch).toHaveBeenNthCalledWith(2, expect.any(String), expect.objectContaining({
    headers: expect.objectContaining({ Authorization: expectedAuth }),
  }));
});
