import cds from '@sap/cds';
import { log } from './logger';

export interface TokenTrackParams {
  requestId: string;
  provider: 'claude' | 'openai' | 'gemini';
  step: 'view_selection' | 'field_matching' | 'embedding';
  inputTokens: number;
  outputTokens: number;
}

export async function trackTokens(params: TokenTrackParams): Promise<void> {
  try {
    const { requestId, provider, step, inputTokens, outputTokens } = params;

    await cds.db.run(
      INSERT.into('TokenLogs').entries({
        requestId,
        provider,
        step,
        inputTokens,
        outputTokens,
      })
    );
  } catch (err) {
    log.warn('Failed to track tokens', {
      error: err instanceof Error ? err.message : String(err),
      params,
    });
  }
}
