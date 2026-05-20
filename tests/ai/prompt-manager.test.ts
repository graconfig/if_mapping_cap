import { PromptManager } from '../../srv/ai/prompt-manager.js';
import { AppError } from '../../srv/utils/errors.js';

jest.mock('../../srv/utils/logger', () => ({
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const mockWhere = jest.fn();
const mockFrom  = jest.fn(() => ({ where: mockWhere }));

beforeAll(() => {
  (global as any).SELECT = { from: mockFrom };
});

beforeEach(() => {
  jest.clearAllMocks();
});

const ACTIVE_ROWS = [
  { language: 'en', step: 'view_selection',  promptType: 'system',      content: 'sys-en-vs'  },
  { language: 'en', step: 'view_selection',  promptType: 'user',        content: 'usr-en-vs'  },
  { language: 'zh', step: 'field_matching',  promptType: 'tool_schema', content: 'ts-zh-fm'   },
];

test('initialize() loads all active prompts into cache', async () => {
  mockWhere.mockResolvedValueOnce(ACTIVE_ROWS);
  const mgr = new PromptManager();
  await mgr.initialize();
  expect(mockFrom).toHaveBeenCalledWith('PromptTemplates');
  expect(mockWhere).toHaveBeenCalledWith({ isActive: true });
});

test('getPrompt() returns correct content for a known key', async () => {
  mockWhere.mockResolvedValueOnce(ACTIVE_ROWS);
  const mgr = new PromptManager();
  await mgr.initialize();
  expect(mgr.getPrompt('view_selection', 'en', 'system')).toBe('sys-en-vs');
  expect(mgr.getPrompt('view_selection', 'en', 'user')).toBe('usr-en-vs');
  expect(mgr.getPrompt('field_matching', 'zh', 'tool_schema')).toBe('ts-zh-fm');
});

test('getPrompt() throws AppError (status 500) for unknown key', async () => {
  mockWhere.mockResolvedValueOnce(ACTIVE_ROWS);
  const mgr = new PromptManager();
  await mgr.initialize();
  try {
    mgr.getPrompt('field_matching', 'ja', 'system');
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).statusCode).toBe(500);
    expect((err as AppError).message).toContain('field_matching');
    expect((err as AppError).message).toContain('ja');
  }
});

test('reload() clears old cache and loads fresh data', async () => {
  mockWhere.mockResolvedValueOnce(ACTIVE_ROWS);
  const mgr = new PromptManager();
  await mgr.initialize();
  expect(mgr.getPrompt('view_selection', 'en', 'system')).toBe('sys-en-vs');

  const UPDATED_ROWS = [
    { language: 'en', step: 'view_selection', promptType: 'system', content: 'updated-content' },
  ];
  mockWhere.mockResolvedValueOnce(UPDATED_ROWS);
  await mgr.reload();

  expect(mgr.getPrompt('view_selection', 'en', 'system')).toBe('updated-content');
  expect(() => mgr.getPrompt('field_matching', 'zh', 'tool_schema')).toThrow(AppError);
});

test('inactive prompts (isActive=false) are NOT loaded', async () => {
  mockWhere.mockResolvedValueOnce([]);
  const mgr = new PromptManager();
  await mgr.initialize();
  expect(mockWhere).toHaveBeenCalledWith({ isActive: true });
});
