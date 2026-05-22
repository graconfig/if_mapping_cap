import { AiCoreClient } from '../ai/aicore-client.js';
import type { CustomField, HanaRepository } from '../repository/hana-repository.js';
import type { RequestConfig } from '../utils/config.js';
import { log } from '../utils/logger.js';
// Generated from schema.cds — run `npm run codegen` after schema changes
import type { InterfaceFieldInput, MatchedFieldResult } from '../../@cds-models/index.js';

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
    rowIndex:    field.rowIndex ?? 0,
    tableId:     cf.targetTable,
    fieldId:     cf.targetField,
    dataType:    cf.dataType    || '',
    fieldText:   cf.targetDesc,
    matchScore,
    matchSource,
    notes:       cf.notes,
    verified:    false,
    obligatory:  cf.obligatory  || undefined,
    sampleValue: cf.sampleValue || undefined,
  };
}

export async function runStep1(
fields: InterfaceFieldInput[], hana: HanaRepository, aiCore: AiCoreClient, config: RequestConfig, correlationId?: string): Promise<Step1Result> {
  const matched:   MatchedFieldResult[]  = [];
  const unmatched: InterfaceFieldInput[] = [];

  type UnmatchedEntry = { field: InterfaceFieldInput; scopeTable?: string; scopeField?: string };
  const pendingVector: UnmatchedEntry[] = [];

  for (const field of fields) {
    const tableId = field.tableId ?? '';
    const fieldId = field.fieldId ?? '';

    if (tableId || fieldId) {
      const { result, isMultiple } = await hana.getExactCustomField(tableId, fieldId);
      if (result) {
        matched.push(toMatchedResult(field, result, 'exact', 1.0));
        continue;
      }
      pendingVector.push({
        field,
        scopeTable: isMultiple ? tableId : undefined,
        scopeField: isMultiple ? fieldId : undefined,
      });
    } else {
      pendingVector.push({ field });
    }
  }

  const stillUnmatched: InterfaceFieldInput[] = [];

  for (const { field, scopeTable, scopeField } of pendingVector) {
    const queryText = [field.ifName, field.tableId, field.fieldId, field.fieldName]
      .filter(Boolean).join(' ');
    const results = await hana.getVectorCustomFields(
      queryText, config.vectorThreshold, 5, scopeTable, scopeField
    );

    if (results.length > 0) {
      matched.push(toMatchedResult(field, results[0], 'vector', results[0].score ?? 0));
    } else {
      stillUnmatched.push(field);
    }
  }

  log.info('Step1 complete', { correlationId, matched: matched.length, unmatched: stillUnmatched.length });
  return { matched, unmatched: stillUnmatched };
}
