import type { InterfaceFieldInput } from './step1-custom-fields.js';
import type { HanaRepository } from '../repository/hana-repository.js';
import type { AiCoreClient } from '../ai/aicore-client.js';
import type { PromptManager } from '../ai/prompt-manager.js';
import type { RequestConfig } from '../utils/config.js';
import { log } from '../utils/logger.js';

export interface Step2Result {
  selectedViews: string[];
}

function fillTemplate(template: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce((acc, [k, v]) => acc.replaceAll(`{${k}}`, v), template);
}

export async function runStep2(
  unmatched:     InterfaceFieldInput[],
  hana:          HanaRepository,
  aiCore:        AiCoreClient,
  prompts:       PromptManager,
  config:        RequestConfig,
  correlationId?: string
): Promise<Step2Result> {
  const text = [...new Set(unmatched.map(f => `${f.module} ${f.ifName} ${f.ifDesc}`))].join(' ');

  const embeddings    = await aiCore.generateEmbeddings([text]);
  const embedding     = embeddings[0];
  const candidateViews = await hana.getRelevantViews(embedding, 30);

  if (candidateViews.length === 0) {
    log.warn('Step2: no candidate views found', { correlationId });
    return { selectedViews: [] };
  }

  let selectedViews: string[];

  try {
    const systemPrompt = prompts.getPrompt('view_selection', config.language, 'system');
    const userTemplate = prompts.getPrompt('view_selection', config.language, 'user');
    const toolSchemaRaw = prompts.getPrompt('view_selection', config.language, 'tool_schema');

    const userPrompt = fillTemplate(userTemplate, {
      fields: JSON.stringify(unmatched),
      views:  JSON.stringify(candidateViews),
    });

    const toolSchema = JSON.parse(toolSchemaRaw);

    const result = await aiCore.callWithTools(
      [
        { role: 'user', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      [toolSchema],
      config.provider,
      config.llmModel
    );

    const toolInput = result.toolInput as { views?: string[] };
    selectedViews = (toolInput.views ?? []).slice(0, config.matchNumber);
  } catch (err) {
    log.warn('Step2: LLM call failed, falling back to all candidates', {
      correlationId,
      error: String(err),
    });
    selectedViews = candidateViews.slice(0, 20).map(v => v.viewName);
  }

  log.info('Step2 complete', { correlationId, selectedViews: selectedViews.length });
  return { selectedViews };
}
