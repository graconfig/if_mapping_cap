import cds from '@sap/cds';
import { trackTokens } from '../../srv/utils/token-tracker';
import * as logger from '../../srv/utils/logger';

jest.mock('@sap/cds', () => ({
  __esModule: true,
  default: {
    db: {
      run: jest.fn(),
    },
  },
}));

jest.mock('../../srv/utils/logger', () => ({
  log: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('tokenTracker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('trackTokens inserts a record with correct fields', async () => {
    const mockDb = cds.db as any;
    const mockInsert = {
      into: jest.fn().mockReturnValue({
        entries: jest.fn().mockResolvedValue({}),
      }),
    };
    mockDb.run = jest.fn().mockResolvedValue({});
    (global as any).INSERT = { into: mockInsert.into };

    const params = {
      requestId: 'req-123',
      provider: 'claude' as const,
      step: 'field_matching' as const,
      inputTokens: 100,
      outputTokens: 50,
    };

    await trackTokens(params);

    expect(mockDb.run).toHaveBeenCalled();
  });

  test('trackTokens does NOT throw on insert failure', async () => {
    const mockDb = cds.db as any;
    const testError = new Error('Insert failed');
    mockDb.run = jest.fn().mockRejectedValue(testError);

    const params = {
      requestId: 'req-456',
      provider: 'openai' as const,
      step: 'embedding' as const,
      inputTokens: 200,
      outputTokens: 100,
    };

    await expect(trackTokens(params)).resolves.not.toThrow();
  });

  test('trackTokens logs warning on insert failure', async () => {
    const mockDb = cds.db as any;
    const testError = new Error('DB connection failed');
    mockDb.run = jest.fn().mockRejectedValue(testError);

    const params = {
      requestId: 'req-789',
      provider: 'gemini' as const,
      step: 'view_selection' as const,
      inputTokens: 50,
      outputTokens: 25,
    };

    await trackTokens(params);

    expect(logger.log.warn).toHaveBeenCalledWith(
      'Failed to track tokens',
      expect.objectContaining({
        error: 'DB connection failed',
      })
    );
  });

  test('accepts all valid provider values', async () => {
    const mockDb = cds.db as any;
    mockDb.run = jest.fn().mockResolvedValue({});

    const providers: Array<'claude' | 'openai' | 'gemini'> = [
      'claude',
      'openai',
      'gemini',
    ];

    for (const provider of providers) {
      await trackTokens({
        requestId: `req-${provider}`,
        provider,
        step: 'field_matching',
        inputTokens: 100,
        outputTokens: 50,
      });
    }

    expect(mockDb.run).toHaveBeenCalledTimes(3);
  });

  test('accepts all valid step values', async () => {
    const mockDb = cds.db as any;
    mockDb.run = jest.fn().mockResolvedValue({});

    const steps: Array<'view_selection' | 'field_matching' | 'embedding'> = [
      'view_selection',
      'field_matching',
      'embedding',
    ];

    for (const step of steps) {
      await trackTokens({
        requestId: `req-${step}`,
        provider: 'claude',
        step,
        inputTokens: 100,
        outputTokens: 50,
      });
    }

    expect(mockDb.run).toHaveBeenCalledTimes(3);
  });
});
