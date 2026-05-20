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
  HANA_CONNECTION:  (): AppError => new AppError('HANA connection failed', 503),
  AI_CORE_AUTH:     (): AppError => new AppError('AI Core authentication failed', 502),
  AI_CORE_TIMEOUT:  (): AppError => new AppError('AI Core request timeout', 504),
  INVALID_PROVIDER: (p: string): AppError => new AppError(`Unknown provider: ${p}`, 400),
  PROMPT_NOT_FOUND: (step: string, lang: string): AppError =>
    new AppError(`No active prompt found for step="${step}" language="${lang}"`, 500),
};
