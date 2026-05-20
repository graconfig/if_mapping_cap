import { runStep2 } from '../../srv/matching/step2-view-selection.js';
import type { Step2Result } from '../../srv/matching/step2-view-selection.js';
import type { InterfaceFieldInput } from '../../srv/matching/step1-custom-fields.js';
import type { HanaRepository, CdsView } from '../../srv/repository/hana-repository.js';
import type { AiCoreClient, ToolResult } from '../../srv/ai/aicore-client.js';
import type { PromptManager } from '../../srv/ai/prompt-manager.js';
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

function makeView(viewName: string, overrides: Partial<CdsView> = {}): CdsView {
  return {
    id:          `id-${viewName}`,
    viewName,
    category:    'Purchasing',
    description: `${viewName} description`,
    score:       0.9,
    ...overrides,
  };
}

const TOOL_SCHEMA_JSON = JSON.stringify({
  name:        'select_relevant_views',
  description: 'Select the most relevant CDS views',
  inputSchema: {
    type:       'object',
    properties: { views: { type: 'array', items: { type: 'string' } } },
    required:   ['views'],
  },
});

function makeMockHana(views: CdsView[]): jest.Mocked<Pick<HanaRepository, 'getRelevantViews'>> {
  return {
    getRelevantViews: jest.fn().mockResolvedValue(views),
  } as any;
}

function makeMockAiCore(
  embeddingResult: number[][] = [[0.1, 0.2, 0.3]],
  toolResult: ToolResult = {
    toolName:  'select_relevant_views',
    toolInput: { views: ['C_PurchaseOrderTP', 'I_PurchaseOrder'] },
    usage:     { inputTokens: 100, outputTokens: 50 },
  }
): jest.Mocked<Pick<AiCoreClient, 'generateEmbeddings' | 'callWithTools'>> {
  return {
    generateEmbeddings: jest.fn().mockResolvedValue(embeddingResult),
    callWithTools:      jest.fn().mockResolvedValue(toolResult),
  } as any;
}

function makeMockPrompts(
  systemPrompt = 'You are a view selector.',
  userTemplate = 'Fields: {fields}\nViews: {views}',
  toolSchemaRaw = TOOL_SCHEMA_JSON
): jest.Mocked<Pick<PromptManager, 'getPrompt'>> {
  return {
    getPrompt: jest.fn((step, _lang, type) => {
      if (type === 'system')      return systemPrompt;
      if (type === 'user')        return userTemplate;
      if (type === 'tool_schema') return toolSchemaRaw;
      return '';
    }),
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

beforeEach(() => {
  jest.clearAllMocks();
});

test('normal flow — vector search returns views, LLM selects subset → returns selected views', async () => {
  const fields = [makeField()];
  const candidates = [
    makeView('C_PurchaseOrderTP'),
    makeView('I_PurchaseOrder'),
    makeView('C_SupplierTP'),
  ];
  const hana   = makeMockHana(candidates);
  const aiCore = makeMockAiCore([[0.1, 0.2, 0.3]], {
    toolName:  'select_relevant_views',
    toolInput: { views: ['C_PurchaseOrderTP', 'I_PurchaseOrder'] },
    usage:     { inputTokens: 100, outputTokens: 50 },
  });
  const prompts = makeMockPrompts();

  const result: Step2Result = await runStep2(fields, hana as any, aiCore as any, prompts as any, defaultConfig);

  expect(result.selectedViews).toEqual(['C_PurchaseOrderTP', 'I_PurchaseOrder']);
  expect(hana.getRelevantViews).toHaveBeenCalledWith([0.1, 0.2, 0.3], 30);
  expect(aiCore.callWithTools).toHaveBeenCalledTimes(1);
});

test('LLM fails → graceful fallback to all candidate views (capped at 20)', async () => {
  const fields = [makeField()];
  const candidates = Array.from({ length: 25 }, (_, i) => makeView(`View${i + 1}`));
  const hana   = makeMockHana(candidates);
  const aiCore = makeMockAiCore([[0.1, 0.2]]);
  (aiCore.callWithTools as jest.Mock).mockRejectedValue(new Error('LLM timeout'));
  const prompts = makeMockPrompts();

  const result: Step2Result = await runStep2(fields, hana as any, aiCore as any, prompts as any, defaultConfig);

  expect(result.selectedViews).toHaveLength(20);
  expect(result.selectedViews[0]).toBe('View1');
  expect(result.selectedViews[19]).toBe('View20');
  expect(log.warn).toHaveBeenCalledWith(
    'Step2: LLM call failed, falling back to all candidates',
    expect.objectContaining({ error: expect.stringContaining('LLM timeout') })
  );
});

test('empty candidates → returns empty selectedViews', async () => {
  const fields  = [makeField()];
  const hana    = makeMockHana([]);
  const aiCore  = makeMockAiCore([[0.5, 0.6]]);
  const prompts = makeMockPrompts();

  const result: Step2Result = await runStep2(fields, hana as any, aiCore as any, prompts as any, defaultConfig);

  expect(result.selectedViews).toEqual([]);
  expect(aiCore.callWithTools).not.toHaveBeenCalled();
  expect(log.warn).toHaveBeenCalledWith(
    'Step2: no candidate views found',
    expect.any(Object)
  );
});

test('views limited to config.matchNumber', async () => {
  const fields = [makeField()];
  const candidates = [
    makeView('ViewA'),
    makeView('ViewB'),
    makeView('ViewC'),
  ];
  const hana   = makeMockHana(candidates);
  const aiCore = makeMockAiCore([[0.1, 0.2]], {
    toolName:  'select_relevant_views',
    toolInput: { views: ['ViewA', 'ViewB', 'ViewC', 'ViewD', 'ViewE'] },
    usage:     { inputTokens: 100, outputTokens: 50 },
  });
  const prompts = makeMockPrompts();

  const config: RequestConfig = { ...defaultConfig, matchNumber: 2 };
  const result: Step2Result = await runStep2(fields, hana as any, aiCore as any, prompts as any, config);

  expect(result.selectedViews).toHaveLength(2);
  expect(result.selectedViews).toEqual(['ViewA', 'ViewB']);
});

test('prompt template fills {fields} and {views} placeholders', async () => {
  const fields = [makeField({ module: 'SD', ifName: 'IF_SD_001', ifDesc: 'Sales order' })];
  const candidates = [makeView('C_SalesOrderTP')];
  const hana   = makeMockHana(candidates);
  const aiCore = makeMockAiCore([[0.3, 0.4]], {
    toolName:  'select_relevant_views',
    toolInput: { views: ['C_SalesOrderTP'] },
    usage:     { inputTokens: 80, outputTokens: 30 },
  });
  const prompts = makeMockPrompts('System prompt', 'Fields={fields};Views={views}');

  await runStep2(fields, hana as any, aiCore as any, prompts as any, defaultConfig);

  const callArgs = (aiCore.callWithTools as jest.Mock).mock.calls[0];
  const messages = callArgs[0] as Array<{ role: string; content: string }>;
  const userMessage = messages.find(m => m.content.startsWith('Fields='));
  expect(userMessage).toBeDefined();
  expect(userMessage!.content).toContain(JSON.stringify(fields));
  expect(userMessage!.content).toContain(JSON.stringify(candidates));
});

test('search text combines unique ifName/ifDesc/module from unmatched fields', async () => {
  const field1 = makeField({ module: 'MM', ifName: 'IF_MM_001', ifDesc: 'Purchase' });
  const field2 = makeField({ rowIndex: 2, module: 'MM', ifName: 'IF_MM_001', ifDesc: 'Purchase', fieldName: 'LIFNR' });
  const field3 = makeField({ rowIndex: 3, module: 'SD', ifName: 'IF_SD_001', ifDesc: 'Sales', fieldName: 'VBELN' });

  const hana   = makeMockHana([makeView('C_PurchaseOrderTP')]);
  const aiCore = makeMockAiCore([[0.1, 0.2]], {
    toolName:  'select_relevant_views',
    toolInput: { views: ['C_PurchaseOrderTP'] },
    usage:     { inputTokens: 50, outputTokens: 20 },
  });
  const prompts = makeMockPrompts();

  await runStep2([field1, field2, field3], hana as any, aiCore as any, prompts as any, defaultConfig);

  const embeddingCall = (aiCore.generateEmbeddings as jest.Mock).mock.calls[0][0];
  expect(embeddingCall).toHaveLength(1);
  const textArg: string = embeddingCall[0];
  expect(textArg).toContain('MM IF_MM_001 Purchase');
  expect(textArg).toContain('SD IF_SD_001 Sales');
  const parts = textArg.split(' ');
  void parts;
  expect(textArg.match(/MM IF_MM_001 Purchase/g)).toHaveLength(1);
});

test('correlationId is forwarded to logger', async () => {
  const fields = [makeField()];
  const hana   = makeMockHana([makeView('C_PurchaseOrderTP')]);
  const aiCore = makeMockAiCore([[0.1, 0.2]], {
    toolName:  'select_relevant_views',
    toolInput: { views: ['C_PurchaseOrderTP'] },
    usage:     { inputTokens: 50, outputTokens: 20 },
  });
  const prompts = makeMockPrompts();

  await runStep2(fields, hana as any, aiCore as any, prompts as any, defaultConfig, 'corr-xyz');

  expect(log.info).toHaveBeenCalledWith(
    'Step2 complete',
    expect.objectContaining({ correlationId: 'corr-xyz' })
  );
});
