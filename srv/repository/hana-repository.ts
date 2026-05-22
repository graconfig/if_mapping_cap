import hana from '@sap/hana-client';
import type {
  CdsView         as _CdsCdsView,
  ViewField       as _CdsViewField,
  TerminologyMapping as _CdsTerminologyMapping,
  CustomField     as _CdsCustomField,
} from '../../@cds-models/external/index.js';
import type {
  CustomFieldUploadInput as _CdsCustomFieldUploadInput,
  UploadResult           as _CdsUploadResult,
} from '../../@cds-models/index.js';

export type TerminologyMapping = _CdsTerminologyMapping;
export type CdsView            = _CdsCdsView & { score?: number };
export type ViewField          = _CdsViewField & { isKey: boolean };
export type CustomField        = _CdsCustomField & { score?: number };
export type CustomFieldRecord  = _CdsCustomFieldUploadInput;
export type UploadResult       = _CdsUploadResult;

function resolveHanaConfig(): Record<string, unknown> {
  if (process.env.VCAP_SERVICES) {
    const vcap = JSON.parse(process.env.VCAP_SERVICES);
    const binding =
      vcap?.['hana']?.[0]?.credentials ??
      vcap?.['hanatrial']?.[0]?.credentials;
    if (binding) {
      return {
        serverNode:             `${binding.host}:${binding.port}`,
        uid:                    binding.user,
        pwd:                    binding.password,
        encrypt:                true,
        sslValidateCertificate: false,
      };
    }
  }
  return {
    serverNode:             `${process.env.HANA_ADDRESS}:${process.env.HANA_PORT ?? '443'}`,
    uid:                    process.env.HANA_USER,
    pwd:                    process.env.HANA_PASSWORD,
    encrypt:                true,
    sslValidateCertificate: false,
  };
}

function nullOrEq(col: string, val: string): string {
  const clean = val.replace(/'/g, "''");
  if (!clean || clean.trim() === '' || clean.trim() === '-') {
    return `("${col}" IS NULL OR "${col}" = '')`;
  }
  return `"${col}" = '${clean}'`;
}

function mapCustomField(row: Record<string, unknown>): CustomField {
  return {
    ID:               String(row['ID']                ?? ''),
    scenario:         String(row['SCENARIO']          ?? ''),
    ifName:           String(row['IFNAME']            ?? ''),
    sourceTable:      String(row['SOURCETABLE']       ?? ''),
    sourceField:      String(row['SOURCEFIELD']       ?? ''),
    sourceDesc:       String(row['SOURCEDESC']        ?? ''),
    sourceType:       String(row['SOURCETYPE']        ?? ''),
    sourceLength:     row['SOURCELENGTH']   != null ? Number(row['SOURCELENGTH'])   : null,
    sourceDecimals:   row['SOURCEDECIMALS'] != null ? Number(row['SOURCEDECIMALS']) : null,
    targetTable:      String(row['TARGETTABLE']       ?? ''),
    targetField:      String(row['TARGETFIELD']       ?? ''),
    targetDesc:       String(row['TARGETDESC']        ?? ''),
    targetType:       String(row['TARGETTYPE']        ?? ''),
    targetLength:     row['TARGETLENGTH']   != null ? Number(row['TARGETLENGTH'])   : null,
    targetDecimals:   row['TARGETDECIMALS'] != null ? Number(row['TARGETDECIMALS']) : null,
    keyFlag:          String(row['KEYFLAG']           ?? ''),
    obligatory:       String(row['OBLIGATORY']        ?? ''),
    allowedValues:    String(row['ALLOWEDVALUES']     ?? ''),
    allowedValuesDesc: String(row['ALLOWEDVALUESDESC'] ?? ''),
    class1:           String(row['CLASS1']            ?? ''),
    class2:           String(row['CLASS2']            ?? ''),
    class3:           String(row['CLASS3']            ?? ''),
    isAppend:         String(row['ISAPPEND']          ?? ''),
    notes:            String(row['NOTES']             ?? ''),
    color:            String(row['COLOR']             ?? ''),
    score:            row['SCORE'] != null ? Number(row['SCORE']) : undefined,
  };
}

export class HanaRepository {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private conn: any;
  private custSchema: string;
  private cdsSchema:  string;

  constructor() {
    this.conn       = (hana as any).createConnection?.() ?? (hana as any).default?.createConnection?.();
    this.custSchema = process.env.HANA_SCHEMA_CUST ?? '';
    this.cdsSchema  = process.env.HANA_SCHEMA      ?? '';
  }

  async connect(): Promise<void> {
    await this.conn.connect(resolveHanaConfig());
    this.conn.setAutoCommit(true);
  }

  async disconnect(): Promise<void> {
    await this.conn.disconnect();
  }

  async getExactCustomField(
    sourceTable: string,
    sourceField: string
  ): Promise<{ result: CustomField | null; isMultiple: boolean }> {
    const cols = `ID, SCENARIO, IFNAME, SOURCETABLE, SOURCEFIELD, SOURCEDESC,
               SOURCETYPE, SOURCELENGTH, SOURCEDECIMALS,
               TARGETTABLE, TARGETFIELD, TARGETDESC,
               TARGETTYPE, TARGETLENGTH, TARGETDECIMALS,
               KEYFLAG, OBLIGATORY, ALLOWEDVALUES, ALLOWEDVALUESDESC,
               CLASS1, CLASS2, CLASS3, ISAPPEND, NOTES, COLOR`;
    const tableCond = nullOrEq('SOURCETABLE', sourceTable);
    const fieldCond = nullOrEq('SOURCEFIELD',  sourceField);
    const sql = `
      SELECT TOP 2 ${cols}
      FROM "${this.custSchema}"."PWC_HAND_AI2REPORT_DEV_CUSTFIELDS"
      WHERE ISACTIVE = 0
        AND ${tableCond}
        AND ${fieldCond}`;
    const rows = await this.conn.exec(sql, []) as Record<string, unknown>[];
    if (rows.length === 0)  return { result: null,               isMultiple: false };
    if (rows.length > 1)    return { result: null,               isMultiple: true  };
    return                         { result: mapCustomField(rows[0]), isMultiple: false };
  }

  async getVectorCustomFields(
    queryText:    string,
    threshold   = 0.75,
    limit       = 5,
    sourceTable?: string,
    sourceField?: string
  ): Promise<CustomField[]> {
    const cols = `ID, SCENARIO, IFNAME, SOURCETABLE, SOURCEFIELD, SOURCEDESC,
            SOURCETYPE, SOURCELENGTH, SOURCEDECIMALS,
            TARGETTABLE, TARGETFIELD, TARGETDESC,
            TARGETTYPE, TARGETLENGTH, TARGETDECIMALS,
            KEYFLAG, OBLIGATORY, ALLOWEDVALUES, ALLOWEDVALUESDESC,
            CLASS1, CLASS2, CLASS3, ISAPPEND, NOTES, COLOR`;
    let scopeFilter = '';
    if (sourceTable !== undefined) scopeFilter += ` AND ${nullOrEq('SOURCETABLE', sourceTable)}`;
    if (sourceField !== undefined) scopeFilter += ` AND ${nullOrEq('SOURCEFIELD', sourceField)}`;
    const sql = `
      SELECT TOP ${limit} ${cols}, SCORE
      FROM (
        SELECT ${cols},
          COSINE_SIMILARITY(VECTOR_EMBEDDING(?, 'QUERY', 'SAP_NEB.20240715'), EMBEDDINGS) AS SCORE
        FROM "${this.custSchema}"."PWC_HAND_AI2REPORT_DEV_CUSTFIELDS"
        WHERE ISACTIVE = 0${scopeFilter}
      ) AS T
      WHERE SCORE > ?
      ORDER BY SCORE DESC`;
    const rows = await this.conn.exec(sql, [queryText, threshold]) as Record<string, unknown>[];
    return rows.map(mapCustomField);
  }

  async getRelevantViews(
    queryText: string,
    limit = 1
  ): Promise<CdsView[]> {
    const sql = `
      SELECT TOP ${limit}
        ID, SCENARIO, DESCRIPTION, VIEWCATEGORY,
        COSINE_SIMILARITY(VECTOR_EMBEDDING(?, 'QUERY', 'SAP_NEB.20240715'), EMBEDDINGS) AS SCORE
      FROM "${this.cdsSchema}"."PWC_HAND_AI2REPORT_DEV_BUSINESSSCENARIOS"
      ORDER BY SCORE DESC`;
    const rows = await this.conn.exec(sql, [queryText]) as Record<string, unknown>[];
    return rows.map(row => ({
      ID:          String(row['ID']           ?? ''),
      viewName:    String(row['SCENARIO']     ?? ''),
      category:    String(row['VIEWCATEGORY'] ?? ''),
      description: String(row['DESCRIPTION']  ?? ''),
      score:       row['SCORE'] != null ? Number(row['SCORE']) : undefined,
    }));
  }

  async getViewsByCategory(category: string): Promise<CdsView[]> {
    const categories = category.split('/').filter(c => c.trim());
    if (categories.length === 0) return [];
    const placeholders = categories.map(() => '?').join(',');
    const sql = `
      SELECT VIEWNAME, VIEWDESC, VIEWCATEGORY
      FROM "${this.cdsSchema}"."PWC_HAND_AI2REPORT_DEV_CDSVIEWS"
      WHERE VIEWCATEGORY IN (${placeholders})
        AND ISACTIVE = 'true'`;
    const rows = await this.conn.exec(sql, categories) as Record<string, unknown>[];
    return rows.map(row => ({
      viewName:    String(row['VIEWNAME']     ?? ''),
      category:    String(row['VIEWCATEGORY'] ?? ''),
      description: String(row['VIEWDESC']     ?? ''),
    }));
  }

  async getTerminologyMappings(): Promise<TerminologyMapping[]> {
    const sql = `
      SELECT SOURCETERM, SOURCETERMALIAS, SOURCECONTEXT,
             TARGETTERM, TARGETTERMALIAS,
             SAPMODULE, SAPTRANSACTION, SAPOBJECTTYPE, SAPTECHNICALNAME,
             CATEGORY, DOMAINAREA, PRIORITY, CONFIDENCE, LANGUAGE
      FROM "${this.cdsSchema}"."PWC_HAND_AI2REPORT_DEV_TERMINOLOGYMAPPING"
      WHERE STATUS = 'ACTIVE'`;
    const rows = await this.conn.exec(sql, []) as Record<string, unknown>[];
    return rows.map(row => ({
      sourceTerm:       String(row['SOURCETERM']       ?? ''),
      sourceTermAlias:  String(row['SOURCETERMALIAS']  ?? ''),
      sourceContext:    String(row['SOURCECONTEXT']    ?? ''),
      targetTerm:       String(row['TARGETTERM']       ?? ''),
      targetTermAlias:  String(row['TARGETTERMALIAS']  ?? ''),
      sapModule:        String(row['SAPMODULE']        ?? ''),
      sapTransaction:   String(row['SAPTRANSACTION']   ?? ''),
      sapObjectType:    String(row['SAPOBJECTTYPE']    ?? ''),
      sapTechnicalName: String(row['SAPTECHNICALNAME'] ?? ''),
      category:         String(row['CATEGORY']         ?? ''),
      domainArea:       String(row['DOMAINAREA']       ?? ''),
      priority:         row['PRIORITY']   != null ? Number(row['PRIORITY'])   : 0,
      confidence:       row['CONFIDENCE'] != null ? Number(row['CONFIDENCE']) : 0,
      language:         String(row['LANGUAGE']         ?? ''),
    }));
  }

  async getViewFields(viewNames: string[]): Promise<ViewField[]> {
    if (viewNames.length === 0) return [];
    const placeholders = viewNames.map(() => '?').join(',');
    const sql = `
      SELECT TABLENAME, CONTENT
      FROM "${this.cdsSchema}"."PWC_HAND_AI2REPORT_DEV_VIEWFIELDS"
      WHERE TABLENAME IN (${placeholders})
        AND LANGU = 'ja'`;
    const rows = await this.conn.exec(sql, viewNames) as Record<string, unknown>[];

    const result: ViewField[] = [];
    for (const row of rows) {
      const tableName  = String(row['TABLENAME'] ?? '');
      const contentStr = String(row['CONTENT']   ?? '');
      if (!contentStr) continue;
      try {
        const start = contentStr.indexOf('[[');
        const end   = contentStr.lastIndexOf(']]');
        if (start === -1 || end === -1) continue;
        const parsed = JSON.parse(contentStr.slice(start, end + 2)) as unknown[][];
        for (const entry of parsed) {
          if (!Array.isArray(entry) || entry.length < 5) continue;
          result.push({
            viewName:  tableName,
            fieldId:   String(entry[0] ?? ''),
            tableId:   tableName,
            dataType:  String(entry[4] ?? ''),
            fieldText: String(entry[2] ?? ''),
            isKey:     Boolean(entry[1]),
          });
        }
      } catch {
        // skip rows with malformed CONTENT
      }
    }
    return result;
  }

  async upsertCustomFields(records: CustomFieldRecord[]): Promise<UploadResult> {
    let inserted = 0;
    for (const r of records) {
      await this.conn.exec(
        `DELETE FROM "${this.custSchema}"."PWC_HAND_AI2REPORT_DEV_CUSTFIELDS"
         WHERE UPPER(SOURCETABLE)=UPPER(?) AND UPPER(SOURCEFIELD)=UPPER(?)`,
        [r.sourceTable, r.sourceField]
      );
      await this.conn.exec(
        `INSERT INTO "${this.custSchema}"."PWC_HAND_AI2REPORT_DEV_CUSTFIELDS"
         (IFNAME,SOURCEDESC,SOURCETABLE,SOURCEFIELD,TARGETTABLE,TARGETFIELD,TARGETDESC,NOTES,ISACTIVE)
         VALUES(?,?,?,?,?,?,?,?,1)`,
        [r.ifName, r.sourceDesc, r.sourceTable, r.sourceField,
         r.targetTable, r.targetField, r.targetDesc, r.notes]
      );
      inserted++;
    }
    return { inserted, updated: 0, deleted: 0 };
  }

  async overwriteCustomFields(records: CustomFieldRecord[]): Promise<UploadResult> {
    await this.conn.exec(
      `DELETE FROM "${this.custSchema}"."PWC_HAND_AI2REPORT_DEV_CUSTFIELDS" WHERE ISACTIVE = 0`
    );
    let inserted = 0;
    for (const r of records) {
      await this.conn.exec(
        `INSERT INTO "${this.custSchema}"."PWC_HAND_AI2REPORT_DEV_CUSTFIELDS"
         (IFNAME,SOURCEDESC,SOURCETABLE,SOURCEFIELD,TARGETTABLE,TARGETFIELD,TARGETDESC,NOTES,ISACTIVE)
         VALUES(?,?,?,?,?,?,?,?,1)`,
        [r.ifName, r.sourceDesc, r.sourceTable, r.sourceField,
         r.targetTable, r.targetField, r.targetDesc, r.notes]
      );
      inserted++;
    }
    return { inserted, updated: 0, deleted: records.length };
  }
}
