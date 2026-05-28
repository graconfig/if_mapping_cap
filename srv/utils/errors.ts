import { t } from './i18n.js';

export class AppError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const Errors = {
  HANA_CONNECTION:  (lang = 'ja'): AppError =>
    new AppError(t('error.hana_connection', lang), 503),
  AI_CORE_AUTH:     (lang = 'ja'): AppError =>
    new AppError(t('error.ai_core_auth', lang), 502),
  AI_CORE_TIMEOUT:  (lang = 'ja'): AppError =>
    new AppError(t('error.ai_core_timeout', lang), 504),
  INVALID_PROVIDER: (p: string, lang = 'ja'): AppError =>
    new AppError(t('error.invalid_provider', lang, { p }), 400),
  PROMPT_NOT_FOUND: (step: string, promptLang: string, uiLang = promptLang): AppError =>
    new AppError(t('error.prompt_not_found', uiLang, { step, lang: promptLang }), 500),
};
