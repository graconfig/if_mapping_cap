import type { HanaRepository, CustomField } from '../repository/hana-repository.js';
import type { AiCoreClient } from '../ai/aicore-client.js';
import type { RequestConfig } from '../utils/config.js';
import { log } from '../utils/logger.js';

export interface InterfaceFieldInput {
  rowIndex:    number;
  module:      string;
  ifName:      string;
  ifDesc:      string;
  fieldName:   string;
  fieldText:   string;
  sampleValue: string;
  remark:      string;
}

export interface MatchedFieldResult {
  rowIndex:    number;
  tableId:     string;
  fieldId:     string;
  dataType:    string;
  fieldText:   string;
  matchScore:  number;
  matchSource: 'exact' | 'vector' | 'ai' | 'error';
  notes:       string;
  verified:    boolean;
}

export interface Step1Result {
  matched:   MatchedFieldResult[];
  unmatched: InterfaceFieldInput[];
}

function toMatchedResult(
  field:       InterfaceFieldInput,
  cf:          CustomField,
  matchSource: 'exact' | 'vector',
  matchScore:  number
): MatchedFieldResult {
  return {
    rowIndex:   field.rowIndex,
    tableId:    cf.targetTable,
    fieldId:    cf.targetField,
    dataType:   '',
    fieldText:  cf.targetDesc,
    matchScore,
    matchSource,
    notes:      cf.notes,
    verified:   false,
  };
}

export async function runStep1(
  fields:        InterfaceFieldInput[],
  hana:          HanaRepository,
  aiCore:        AiCoreClient,
  config:        RequestConfig,
  correlationId?: string
): Promise<Step1Result> {
  const matched:   MatchedFieldResult[]  = [];
  const unmatched: InterfaceFieldInput[] = [];

  for (const field of fields) {
    const exact = await hana.getExactCustomField(field.fieldName);
    if (exact) {
      matched.push(toMatchedResult(field, exact, 'exact', 1.0));
    } else {
      unmatched.push(field);
    }
  }

  let stillUnmatched = unmatched;

  if (unmatched.length > 0) {
    const texts      = unmatched.map(f => `${f.fieldText} ${f.fieldName}`);
    const embeddings = await aiCore.generateEmbeddings(texts);
    stillUnmatched   = [];

    for (let i = 0; i < unmatched.length; i++) {
      const field     = unmatched[i];
      const embedding = embeddings[i];
      const results   = await hana.getVectorCustomFields(embedding, config.vectorThreshold);

      if (results.length > 0) {
        matched.push(toMatchedResult(field, results[0], 'vector', results[0].score ?? 0));
      } else {
        stillUnmatched.push(field);
      }
    }
  }

  log.info('Step1 complete', { correlationId, matched: matched.length, unmatched: stillUnmatched.length });
  return { matched, unmatched: stillUnmatched };
}
