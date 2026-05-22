import type { MatchedFieldResult } from '../../@cds-models/index.js';
import type { RequestConfig } from '../utils/config.js';
import { log } from '../utils/logger.js';

export interface Step4Result {
  results: MatchedFieldResult[];
}

export async function runStep4(
  results:        MatchedFieldResult[],
  config:         RequestConfig,
  correlationId?: string
): Promise<Step4Result> {
  if (!config.verifyFlag) {
    return { results };
  }

  const odataUrl  = process.env.ODATA_URL;
  const odataUser = process.env.ODATA_USER     ?? '';
  const odataPass = process.env.ODATA_PASSWORD ?? '';

  if (!odataUrl) {
    log.warn('Step4: ODATA_URL not set, skipping verification', { correlationId });
    return { results };
  }

  const basicAuth = `Basic ${Buffer.from(`${odataUser}:${odataPass}`).toString('base64')}`;

  let csrfToken: string;
  try {
    const csrfResponse = await fetch(odataUrl, {
      method:  'GET',
      headers: {
        'X-CSRF-Token': 'Fetch',
        'Authorization': basicAuth,
      },
    });
    const token = csrfResponse.headers.get('x-csrf-token');
    if (!token) {
      log.warn('Step4: CSRF token missing in response, skipping verification', { correlationId });
      return { results };
    }
    csrfToken = token;
  } catch (err) {
    log.warn('Step4: CSRF fetch failed, skipping verification', { correlationId, error: String(err) });
    return { results };
  }

  const updated: MatchedFieldResult[] = [];
  let verifiedCount = 0;
  let skippedCount  = 0;

  for (const result of results) {
    if (result.matchSource === 'error') {
      updated.push({ ...result, verified: false });
      skippedCount++;
      continue;
    }

    try {
      const response = await fetch(odataUrl, {
        method:  'POST',
        headers: {
          'X-CSRF-Token':  csrfToken,
          'Content-Type':  'application/json',
          'Authorization': basicAuth,
        },
        body: JSON.stringify({ tableId: result.tableId, fieldId: result.fieldId }),
      });

      if (response.ok) {
        updated.push({ ...result, verified: true });
        verifiedCount++;
      } else {
        log.warn('Step4: POST verification failed', { correlationId, rowIndex: result.rowIndex });
        updated.push({ ...result, verified: false });
      }
    } catch (err) {
      log.warn('Step4: POST verification error', { correlationId, rowIndex: result.rowIndex, error: String(err) });
      updated.push({ ...result, verified: false });
    }
  }

  log.info('Step4 complete', { correlationId, verified: verifiedCount, skipped: skippedCount });
  return { results: updated };
}
