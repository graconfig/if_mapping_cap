export type Provider = 'claude' | 'openai' | 'gemini';
export type Language = 'en' | 'zh' | 'ja';

export interface RequestConfig {
  provider:        Provider;
  language:        Language;
  llmModel:        string;
  embedModel:      string;
  batchSize:       number;
  maxWorkers:      number;
  vectorThreshold: number;
  matchNumber:     number;
  verifyFlag:      boolean;
}

const MODEL_MAP: Record<Provider, string> = {
  claude: process.env.CLAUDE_LLM_MODEL  ?? 'anthropic--claude-4.5-sonnet',
  openai: process.env.OPENAI_LLM_MODEL  ?? 'gpt-4o',
  gemini: process.env.GEMINI_LLM_MODEL  ?? 'gemini-1.5-pro',
};

const VALID_PROVIDERS: Provider[] = ['claude', 'openai', 'gemini'];
const VALID_LANGUAGES: Language[] = ['en', 'zh', 'ja'];

export function buildRequestConfig(
  rawProvider: string,
  rawLanguage: string
): RequestConfig {
  const provider: Provider = VALID_PROVIDERS.includes(rawProvider as Provider)
    ? (rawProvider as Provider)
    : 'claude';

  const language: Language = VALID_LANGUAGES.includes(rawLanguage as Language)
    ? (rawLanguage as Language)
    : 'ja';

  return {
    provider,
    language,
    llmModel:        MODEL_MAP[provider],
    embedModel:      process.env.TEXT_EMBEDDING_MODEL    ?? 'text-embedding-ada-002',
    batchSize:       Number(process.env.LLM_BATCH_SIZE)  || 30,
    maxWorkers:      Number(process.env.LLM_MAX_WORKERS) || 5,
    vectorThreshold: Number(process.env.CUSTOM_FIELD_THRESHOLD) || 0.75,
    matchNumber:     Number(process.env.MATCH_NUMBER)    || 3,
    verifyFlag:      (process.env.VERIFY_FLAG ?? 'false').toLowerCase() === 'true',
  };
}
