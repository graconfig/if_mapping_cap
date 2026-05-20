import { AiCoreClient } from '../../srv/ai/aicore-client.js';
import type { ToolSchema, Message } from '../../srv/ai/aicore-client.js';

const mockFetch = jest.fn();
global.fetch = mockFetch as typeof fetch;

const ENV = {
  AICORE_AUTH_URL:       'https://auth.example.com/oauth/token',
  AICORE_CLIENT_ID:      'client-id',
  AICORE_CLIENT_SECRET:  'client-secret',
  AICORE_BASE_URL:       'https://api.ai.example.com',
  AICORE_RESOURCE_GROUP: 'default',
};

beforeEach(() => {
  Object.assign(process.env, ENV);
  jest.clearAllMocks();
});

function mockTokenResponse() {
  mockFetch.mockResolvedValueOnce({
    ok:   true,
    json: async () => ({ access_token: 'test-token', expires_in: 3600 }),
  } as Response);
}

function mockLLMResponse(toolName: string, toolInput: unknown) {
  mockFetch.mockResolvedValueOnce({
    ok:   true,
    json: async () => ({
      content: [{ type: 'tool_use', name: toolName, input: toolInput }],
      usage:   { input_tokens: 100, output_tokens: 50 },
    }),
  } as Response);
}

test('callWithTools fetches token then calls LLM endpoint', async () => {
  mockTokenResponse();
  mockLLMResponse('select_relevant_views', { views: ['C_PurchaseOrderTP'] });

  const client = new AiCoreClient();
  const messages: Message[] = [{ role: 'user', content: 'test' }];
  const tools: ToolSchema[] = [{
    name: 'select_relevant_views',
    description: 'Select views',
    inputSchema: {
      type: 'object',
      properties: { views: { type: 'array', items: { type: 'string' } } },
      required: ['views'],
    },
  }];

  const result = await client.callWithTools(messages, tools, 'claude', 'anthropic--claude-4.5-sonnet');
  expect(result.toolName).toBe('select_relevant_views');
  expect(result.toolInput).toEqual({ views: ['C_PurchaseOrderTP'] });
  expect(result.usage.inputTokens).toBe(100);
  expect(mockFetch).toHaveBeenCalledTimes(2);
});

test('callWithTools reuses cached token on second call', async () => {
  mockTokenResponse();
  mockLLMResponse('select_relevant_views', { views: [] });
  mockLLMResponse('select_relevant_views', { views: [] });

  const client = new AiCoreClient();
  const messages: Message[] = [{ role: 'user', content: 'test' }];
  const tools: ToolSchema[] = [{
    name: 'select_relevant_views',
    description: 'test',
    inputSchema: { type: 'object', properties: {}, required: [] },
  }];

  await client.callWithTools(messages, tools, 'claude', 'model');
  await client.callWithTools(messages, tools, 'claude', 'model');

  const tokenCalls = mockFetch.mock.calls.filter(c =>
    String(c[0]).includes('oauth/token')
  );
  expect(tokenCalls).toHaveLength(1);
});

test('generateEmbeddings returns 2D array', async () => {
  mockTokenResponse();
  mockFetch.mockResolvedValueOnce({
    ok:   true,
    json: async () => ({
      data:  [{ embedding: [0.1, 0.2, 0.3] }, { embedding: [0.4, 0.5, 0.6] }],
      usage: { prompt_tokens: 10, total_tokens: 10 },
    }),
  } as Response);

  const client = new AiCoreClient();
  const result = await client.generateEmbeddings(['text1', 'text2']);
  expect(result).toHaveLength(2);
  expect(result[0]).toEqual([0.1, 0.2, 0.3]);
});
