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
  const result = await repo.getExactCustomField('EKKO', 'EBELN');
  expect(result).toBeNull();
});

test('getExactCustomField returns mapped CustomField', async () => {
  mockExec.mockResolvedValueOnce([{
    ID: '1', IFNAME: 'IF001', SOURCETABLE: 'EKKO', SOURCEFIELD: 'EBELN',
    SOURCEDESC: 'PO Number', TARGETTABLE: 'EKKO', TARGETFIELD: 'EBELN',
    TARGETDESC: '購買伝票番号', NOTES: '', ISACTIVE: 1
  }]);
  const repo = new HanaRepository();
  await repo.connect();
  const result = await repo.getExactCustomField('EKKO', 'EBELN');
  expect(result).not.toBeNull();
  expect(result!.sourceTable).toBe('EKKO');
  expect(result!.targetField).toBe('EBELN');
});

test('getVectorCustomFields passes threshold to SQL', async () => {
  mockExec.mockResolvedValueOnce([]);
  const repo = new HanaRepository();
  await repo.connect();
  await repo.getVectorCustomFields([0.1, 0.2], 0.8, 3);
  expect(mockExec).toHaveBeenCalledWith(
    expect.stringContaining('COSINE_SIMILARITY'),
    expect.arrayContaining([expect.any(String), expect.any(String), 0.8])
  );
});

test('getViewFields returns empty array when no views requested', async () => {
  const repo = new HanaRepository();
  await repo.connect();
  const result = await repo.getViewFields([]);
  expect(result).toEqual([]);
  expect(mockExec).not.toHaveBeenCalled();
});
