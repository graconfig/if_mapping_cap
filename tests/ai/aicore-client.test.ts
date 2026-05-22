import { AiCoreClient } from '../../srv/ai/aicore-client.js';
import type { ToolSchema, Message } from '../../srv/ai/aicore-client.js';

const mockFetch = jest.fn();
global.fetch = mockFetch as typeof fetch;

const ENV = {
  AICORE_AUTH_URL:       'https://auth.example.com/oauth/token',
  AICORE_CLIENT_ID:      'client-id',
  AICORE_CLIENT_SECRET:  'client-secret',
  AICORE_BASE_URL:       'https://api.ai.example.com/v2',
  AICORE_RESOURCE_GROUP: 'default',
};

beforeEach(() => {
  Object.assign(process.env, ENV);
  jest.clearAllMocks();
});

function mockTokenResponse() {
  const body = JSON.stringify({ access_token: 'test-token', expires_in: 3600 });
  mockFetch.mockResolvedValueOnce({
    ok:     true,
    status: 200,
    text:   async () => body,
  } as unknown as Response);
}

// Returns a deployments list with one matching entry
function mockDeploymentsResponse(modelName: string, deploymentId: string) {
  mockFetch.mockResolvedValueOnce({
    ok:   true,
    json: async () => ({
      resources: [{
        id:                deploymentId,
        configurationName: `${modelName}-config`,
        details: {
          resources: {
            backendDetails: { model: { name: modelName, version: 'latest' } },
          },
        },
      }],
    }),
  } as Response);
}

// Simulates a failed deployments call — client falls back to model name as deployment ID
function mockDeploymentsFail() {
  mockFetch.mockResolvedValueOnce({ ok: false, status: 500 } as Response);
}

// Converse API response format (Claude provider)
function mockConverseResponse(toolName: string, toolInput: unknown) {
  mockFetch.mockResolvedValueOnce({
    ok:   true,
    json: async () => ({
      output: {
        message: {
          content: [{ toolUse: { name: toolName, input: toolInput } }],
        },
      },
      usage: { inputTokens: 100, outputTokens: 50 },
    }),
  } as Response);
}

// Chat Completion API response format (non-Claude providers)
function mockChatCompletionResponse(toolName: string, toolInput: unknown) {
  mockFetch.mockResolvedValueOnce({
    ok:   true,
    json: async () => ({
      choices: [{
        message: {
          tool_calls: [{
            function: {
              name:      toolName,
              arguments: JSON.stringify(toolInput),
            },
          }],
        },
      }],
      usage: { prompt_tokens: 100, completion_tokens: 50 },
    }),
  } as Response);
}

test('callWithTools (claude) uses Converse API and parses toolUse response', async () => {
  mockTokenResponse();
  mockDeploymentsFail();
  mockConverseResponse('select_relevant_views', { views: ['C_PurchaseOrderTP'] });

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

  const result = await client.callWithTools(messages, tools, 'claude', 'anthropic--claude-4-5-sonnet');
  expect(result.toolName).toBe('select_relevant_views');
  expect(result.toolInput).toEqual({ views: ['C_PurchaseOrderTP'] });
  expect(result.usage.inputTokens).toBe(100);
  expect(result.usage.outputTokens).toBe(50);
  expect(mockFetch).toHaveBeenCalledTimes(3); // token + deployments + converse

  const llmCall = mockFetch.mock.calls[2];
  expect(String(llmCall[0])).toContain('/converse');
});

test('callWithTools (openai) uses Chat Completion API and parses tool_calls response', async () => {
  mockTokenResponse();
  mockDeploymentsFail();
  mockChatCompletionResponse('select_relevant_views', { views: ['C_PurchaseOrderTP'] });

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

  const result = await client.callWithTools(messages, tools, 'openai', 'gpt-4o');
  expect(result.toolName).toBe('select_relevant_views');
  expect(result.toolInput).toEqual({ views: ['C_PurchaseOrderTP'] });
  expect(result.usage.inputTokens).toBe(100);
  expect(result.usage.outputTokens).toBe(50);

  const llmCall = mockFetch.mock.calls[2];
  expect(String(llmCall[0])).toContain('/chat/completions');
});

test('resolveDeploymentId — matches by model name and uses resolved ID in URL', async () => {
  mockTokenResponse();
  mockDeploymentsResponse('anthropic--claude-3-5-sonnet', 'd9eb209d94991674');
  mockConverseResponse('my_tool', { result: 'ok' });

  const client = new AiCoreClient();
  await client.callWithTools(
    [{ role: 'user', content: 'test' }],
    [{ name: 'my_tool', description: '', inputSchema: { type: 'object', properties: {}, required: [] } }],
    'claude',
    'anthropic--claude-3-5-sonnet'
  );

  // Converse URL must contain the resolved deployment ID, not the model name
  const converseCall = mockFetch.mock.calls[2];
  expect(String(converseCall[0])).toContain('/deployments/d9eb209d94991674/converse');
});

test('resolveDeploymentId — caches deployment ID, only calls deployments API once', async () => {
  mockTokenResponse();
  mockDeploymentsFail();              // first call: deployments API (fails, caches fallback)
  mockConverseResponse('t', {});     // first call: converse
  mockConverseResponse('t', {});     // second call: converse (deployment cached → no deployments fetch)

  const client = new AiCoreClient();
  const messages: Message[] = [{ role: 'user', content: 'x' }];
  const tools: ToolSchema[] = [{ name: 't', description: '', inputSchema: { type: 'object', properties: {}, required: [] } }];

  await client.callWithTools(messages, tools, 'claude', 'model');
  await client.callWithTools(messages, tools, 'claude', 'model');

  const deploymentCalls = mockFetch.mock.calls.filter(c =>
    String(c[0]).includes('/lm/deployments')
  );
  expect(deploymentCalls).toHaveLength(1);
});

test('callWithTools (claude) reuses cached token on second call', async () => {
  mockTokenResponse();
  mockDeploymentsFail();
  mockConverseResponse('select_relevant_views', { views: [] });
  mockConverseResponse('select_relevant_views', { views: [] });

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

test('callWithTools (claude) sends correct Converse request body', async () => {
  mockTokenResponse();
  mockDeploymentsFail();
  mockConverseResponse('my_tool', { result: 'ok' });

  const client = new AiCoreClient();
  const messages: Message[] = [{ role: 'user', content: 'hello' }];
  const tools: ToolSchema[] = [{
    name:        'my_tool',
    description: 'A tool',
    inputSchema: { type: 'object', properties: { result: { type: 'string' } }, required: ['result'] },
  }];

  await client.callWithTools(messages, tools, 'claude', 'dep-abc');

  const llmCall = mockFetch.mock.calls[2];
  const reqBody = JSON.parse(llmCall[1].body as string);

  expect(reqBody.messages[0]).toEqual({
    role:    'user',
    content: [{ type: 'text', text: 'hello' }],
  });

  expect(reqBody.toolConfig.tools[0]).toEqual({
    toolSpec: {
      name:        'my_tool',
      description: 'A tool',
      inputSchema: {
        json: { type: 'object', properties: { result: { type: 'string' } }, required: ['result'] },
      },
    },
  });

  expect(reqBody.toolConfig.toolChoice).toEqual({ any: {} });
});

test('generateEmbeddings returns 2D array', async () => {
  mockTokenResponse();
  mockDeploymentsFail();
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

  const embeddingCall = mockFetch.mock.calls[2];
  expect(String(embeddingCall[0])).toContain('/embeddings');
});
