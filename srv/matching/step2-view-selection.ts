import type { InterfaceFieldInput } from '../../@cds-models/index.js';
import type { AiCoreClient } from '../ai/aicore-client.js';
import type { PromptManager } from '../ai/prompt-manager.js';
import type { HanaRepository } from '../repository/hana-repository.js';
import type { RequestConfig } from '../utils/config.js';
import { log } from '../utils/logger.js';
import { trackTokens } from '../utils/token-tracker.js';

export interface Step2Result {
  selectedViews: string[];
}

function fillTemplate(template: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce((acc, [k, v]) => acc.replaceAll(`{${k}}`, v), template);
}

export async function runStep2(
  unmatched:        InterfaceFieldInput[],
  hana:             HanaRepository,
  aiCore:           AiCoreClient,
  prompts:          PromptManager,
  config:           RequestConfig,
  correlationId?:   string,
  terminologyText?: string
): Promise<Step2Result> {
  const text = [...new Set(unmatched.map(f => `${f.module} ${f.ifName} ${f.ifDesc}`))].join(' ');

  // Step 1: vector search on BUSINESSSCENARIOS → get top VIEWCATEGORY
  const scenarios = await hana.getRelevantViews(text, 3);
  if (scenarios.length === 0) {
    log.warn('Step2: no candidate scenarios found', { correlationId });
    return { selectedViews: [] };
  }

  const topCategory = scenarios[0].category ?? '';

  // Step 2: fetch views from CDSVIEWS filtered by category
  const candidateViews = await hana.getViewsByCategory(topCategory);
  if (candidateViews.length === 0) {
    log.warn('Step2: no views for category', { correlationId, category: topCategory });
    return { selectedViews: [] };
  }

  let selectedViews: string[];

  try {
    const userTemplate  = prompts.getPrompt('view_selection', config.language, 'user');
    const toolSchemaRaw = prompts.getPrompt('view_selection', config.language, 'tool_schema');

    const fieldsText = unmatched
      .map(f => Object.values(f).map(v => String(v ?? '')).join(','))
      .join('\n');
    const viewsText = candidateViews
      .map(v => `${v.viewName ?? ''},${v.description ?? ''}`)
      .join('\n');

    const userPrompt = fillTemplate(userTemplate, {
      module:      unmatched[0]?.module  ?? '',
      if_name:     unmatched[0]?.ifName  ?? '',
      if_desc:     unmatched[0]?.ifDesc  ?? '',
      fields:      fieldsText,
      views:       viewsText,
      terminology: terminologyText ?? '',
    });

    const toolSchema = JSON.parse(toolSchemaRaw);

    const result = await aiCore.callWithTools(
      [
        { role: 'user', content: userPrompt },
      ],
      [toolSchema],
      config.provider,
      config.llmModel
    );

    void trackTokens({
      requestId:    correlationId ?? 'unknown',
      provider:     config.provider as 'claude' | 'openai' | 'gemini',
      step:         'view_selection',
      inputTokens:  result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
    });
    const toolInput = result.toolInput as { relevant_view_names?: string[] };
    selectedViews = (toolInput.relevant_view_names ?? []);
  } catch (err) {
    log.warn('Step2: LLM call failed, falling back to all candidates', {
      correlationId,
      error: String(err),
    });
    selectedViews = candidateViews.slice(0, 20).map(v => v.viewName ?? '');
  }

  log.info('Step2 complete', { correlationId, selectedViews: selectedViews.length });
  return { selectedViews };
}
