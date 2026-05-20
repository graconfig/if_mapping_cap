import hana from '@sap/hana-client';

export interface CustomField {
  id:          string;
  ifName:      string;
  sourceTable: string;
  sourceField: string;
  sourceDesc:  string;
  targetTable: string;
  targetField: string;
  targetDesc:  string;
  notes:       string;
  score?:      number;
}

export interface CdsView {
  id:          string;
  viewName:    string;
  category:    string;
  description: string;
  score?:      number;
}

export interface ViewField {
  viewName:  string;
  fieldId:   string;
  tableId:   string;
  dataType:  string;
  fieldText: string;
}

export interface CustomFieldRecord {
  ifName:      string;
  sourceDesc:  string;
  sourceTable: string;
  sourceField: string;
  targetDesc:  string;
  targetTable: string;
  targetField: string;
  notes:       string;
}

export interface UploadResult {
  inserted: number;
  updated:  number;
  deleted:  number;
}

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

function toVectorString(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}

function mapCustomField(row: Record<string, unknown>): CustomField {
  return {
    id:          String(row['ID']          ?? ''),
    ifName:      String(row['IFNAME']      ?? ''),
    sourceTable: String(row['SOURCETABLE'] ?? ''),
    sourceField: String(row['SOURCEFIELD'] ?? ''),
    sourceDesc:  String(row['SOURCEDESC']  ?? ''),
    targetTable: String(row['TARGETTABLE'] ?? ''),
    targetField: String(row['TARGETFIELD'] ?? ''),
    targetDesc:  String(row['TARGETDESC']  ?? ''),
    notes:       String(row['NOTES']       ?? ''),
    score:       row['SCORE'] != null ? Number(row['SCORE']) : undefined,
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
  ): Promise<CustomField | null> {
    const sql = `
      SELECT ID, IFNAME, SOURCETABLE, SOURCEFIELD, SOURCEDESC,
             TARGETTABLE, TARGETFIELD, TARGETDESC, NOTES, ISACTIVE
      FROM "${this.custSchema}"."PWC_HAND_AI2REPORT_DEV_CUSTFIELDS"
      WHERE ISACTIVE = 1
        AND UPPER(SOURCETABLE) = UPPER(?)
        AND UPPER(SOURCEFIELD) = UPPER(?)
      LIMIT 1`;
    const rows = await this.conn.exec(sql, [sourceTable, sourceField]) as Record<string, unknown>[];
    return rows.length > 0 ? mapCustomField(rows[0]) : null;
  }

  async getVectorCustomFields(
    embedding: number[],
    threshold = 0.75,
    limit = 5
  ): Promise<CustomField[]> {
    const vec = toVectorString(embedding);
    const sql = `
      SELECT TOP ${limit}
        ID, IFNAME, SOURCETABLE, SOURCEFIELD, SOURCEDESC,
        TARGETTABLE, TARGETFIELD, TARGETDESC, NOTES,
        COSINE_SIMILARITY(EMBEDDING, TO_REAL_VECTOR(?)) AS SCORE
      FROM "${this.custSchema}"."PWC_HAND_AI2REPORT_DEV_CUSTFIELDS"
      WHERE ISACTIVE = 1
        AND COSINE_SIMILARITY(EMBEDDING, TO_REAL_VECTOR(?)) > ?
      ORDER BY SCORE DESC`;
    const rows = await this.conn.exec(sql, [vec, vec, threshold]) as Record<string, unknown>[];
    return rows.map(mapCustomField);
  }

  async getRelevantViews(
    embedding: number[],
    limit = 20
  ): Promise<CdsView[]> {
    const vec = toVectorString(embedding);
    const sql = `
      SELECT TOP ${limit}
        ID, VIEWNAME, CATEGORY, DESCRIPTION,
        COSINE_SIMILARITY(EMBEDDING, TO_REAL_VECTOR(?)) AS SCORE
      FROM "${this.cdsSchema}"."PWC_HAND_AI2REPORT_DEV_CDSVIEWS"
      ORDER BY SCORE DESC`;
    const rows = await this.conn.exec(sql, [vec]) as Record<string, unknown>[];
    return rows.map(row => ({
      id:          String(row['ID']          ?? ''),
      viewName:    String(row['VIEWNAME']    ?? ''),
      category:    String(row['CATEGORY']    ?? ''),
      description: String(row['DESCRIPTION'] ?? ''),
      score:       row['SCORE'] != null ? Number(row['SCORE']) : undefined,
    }));
  }

  async getViewFields(viewNames: string[]): Promise<ViewField[]> {
    if (viewNames.length === 0) return [];
    const placeholders = viewNames.map(() => '?').join(',');
    const sql = `
      SELECT VIEWNAME, FIELDID, TABLEID, DATATYPE, FIELDTEXT
      FROM "${this.cdsSchema}"."PWC_HAND_AI2REPORT_DEV_VIEWFIELDS"
      WHERE VIEWNAME IN (${placeholders})`;
    const rows = await this.conn.exec(sql, viewNames) as Record<string, unknown>[];
    return rows.map(row => ({
      viewName:  String(row['VIEWNAME']  ?? ''),
      fieldId:   String(row['FIELDID']   ?? ''),
      tableId:   String(row['TABLEID']   ?? ''),
      dataType:  String(row['DATATYPE']  ?? ''),
      fieldText: String(row['FIELDTEXT'] ?? ''),
    }));
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
