import { HanaRepository } from '../../srv/repository/hana-repository.js';

// Mock @sap/hana-client
const mockExec = jest.fn();
const mockConn = {
  exec:             mockExec,
  disconnect:       jest.fn(),
  setAutoCommit:    jest.fn(),
  connect:          jest.fn(),
};
jest.mock('@sap/hana-client', () => ({
  default: { createConnection: () => mockConn },
  createConnection: () => mockConn,
}));

const ENV = {
  HANA_ADDRESS:     'test.hana.com',
  HANA_PORT:        '443',
  HANA_USER:        'user',
  HANA_PASSWORD:    'pass',
  HANA_SCHEMA_CUST: 'CUST_SCHEMA',
  HANA_SCHEMA:      'CDS_SCHEMA',
};

beforeEach(() => {
  Object.assign(process.env, ENV);
  jest.clearAllMocks();
  mockConn.connect.mockResolvedValue(undefined);
});

test('getExactCustomField returns null when no rows', async () => {
  mockExec.mockResolvedValueOnce([]);
  const repo = new HanaRepository();
  await repo.connect();
  const { result, isMultiple } = await repo.getExactCustomField('EKKO', 'EBELN');
  expect(result).toBeNull();
  expect(isMultiple).toBe(false);
});

test('getExactCustomField returns isMultiple when 2 rows', async () => {
  mockExec.mockResolvedValueOnce([
    { ID: '1', IFNAME: 'IF001', SOURCETABLE: 'EKKO', SOURCEFIELD: 'EBELN', SOURCEDESC: '', TARGETTABLE: '', TARGETFIELD: '', TARGETDESC: '', NOTES: '' },
    { ID: '2', IFNAME: 'IF001', SOURCETABLE: 'EKKO', SOURCEFIELD: 'EBELN', SOURCEDESC: '', TARGETTABLE: '', TARGETFIELD: '', TARGETDESC: '', NOTES: '' },
  ]);
  const repo = new HanaRepository();
  await repo.connect();
  const { result, isMultiple } = await repo.getExactCustomField('EKKO', 'EBELN');
  expect(result).toBeNull();
  expect(isMultiple).toBe(true);
});

test('getExactCustomField returns mapped CustomField', async () => {
  mockExec.mockResolvedValueOnce([{
    ID: '1', IFNAME: 'IF001', SOURCETABLE: 'EKKO', SOURCEFIELD: 'EBELN',
    SOURCEDESC: 'PO Number', TARGETTABLE: 'EKKO', TARGETFIELD: 'EBELN',
    TARGETDESC: '購買伝票番号', NOTES: '',
  }]);
  const repo = new HanaRepository();
  await repo.connect();
  const { result, isMultiple } = await repo.getExactCustomField('EKKO', 'EBELN');
  expect(isMultiple).toBe(false);
  expect(result).not.toBeNull();
  expect(result!.sourceTable).toBe('EKKO');
  expect(result!.targetField).toBe('EBELN');
});

test('getExactCustomField embeds nullOrEq conditions into SQL (no bind params for table/field)', async () => {
  mockExec.mockResolvedValueOnce([]);
  const repo = new HanaRepository();
  await repo.connect();
  await repo.getExactCustomField('EKKO', 'EBELN');
  const [sql, params] = mockExec.mock.calls[0] as [string, unknown[]];
  expect(sql).toContain(`"SOURCETABLE" = 'EKKO'`);
  expect(sql).toContain(`"SOURCEFIELD" = 'EBELN'`);
  expect(params).toEqual([]);
});

test('getVectorCustomFields passes queryText and threshold as bind params', async () => {
  mockExec.mockResolvedValueOnce([]);
  const repo = new HanaRepository();
  await repo.connect();
  await repo.getVectorCustomFields('EBELN 購買伝票番号', 0.8, 3);
  const [sql, params] = mockExec.mock.calls[0] as [string, unknown[]];
  expect(sql).toContain('COSINE_SIMILARITY');
  expect(params).toEqual(['EBELN 購買伝票番号', 0.8]);
});

test('getVectorCustomFields embeds nullOrEq scope filter into SQL when scope provided', async () => {
  mockExec.mockResolvedValueOnce([]);
  const repo = new HanaRepository();
  await repo.connect();
  await repo.getVectorCustomFields('EBELN', 0.75, 5, 'EKKO', 'EBELN');
  const [sql, params] = mockExec.mock.calls[0] as [string, unknown[]];
  expect(sql).toContain(`"SOURCETABLE" = 'EKKO'`);
  expect(sql).toContain(`"SOURCEFIELD" = 'EBELN'`);
  expect(params).toEqual(['EBELN', 0.75]);
});

test('getViewFields returns empty array when no views requested', async () => {
  const repo = new HanaRepository();
  await repo.connect();
  const result = await repo.getViewFields([]);
  expect(result).toEqual([]);
  expect(mockExec).not.toHaveBeenCalled();
});
