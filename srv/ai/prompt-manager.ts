import { Errors } from '../utils/errors.js';
import { log } from '../utils/logger.js';

export type PromptStep = 'view_selection' | 'field_matching';
export type Language = 'en' | 'zh' | 'ja';
export type PromptType = 'user' | 'tool_schema';

interface PromptRow {
  language:   string;
  step:       string;
  promptType: string;
  content:    string;
}

export class PromptManager {
  private cache = new Map<string, string>();

  async initialize(): Promise<void> {
    const rows = await SELECT.from('PromptTemplates').where({ isActive: true }) as PromptRow[];
    this.cache.clear();
    for (const row of rows) {
      this.cache.set(`${row.step}::${row.language}::${row.promptType}`, row.content);
    }
    log.info('PromptManager initialized', { count: rows.length });
  }

  getPrompt(step: PromptStep, language: Language, promptType: PromptType): string {
    const key = `${step}::${language}::${promptType}`;
    const content = this.cache.get(key);
    if (content === undefined) throw Errors.PROMPT_NOT_FOUND(step, language);
    return content;
  }

  async reload(): Promise<void> {
    await this.initialize();
  }
}

export const promptManager = new PromptManager();
