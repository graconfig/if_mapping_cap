using { cuid } from '@sap/cds/common';

// ── External HANA tables (not managed by CAP) ─────────────────────────────────

context external {

  @cds.persistence.exists
  entity CdsViews {
    key ID          : String(36);
        viewName    : String(200);
        category    : String(100);
        description : String(500);
  }

  @cds.persistence.exists
  entity ViewFields {
    key viewName  : String(200);
    key fieldId   : String(60);
        tableId   : String(60);
        dataType  : String(30);
        fieldText : String(500);
  }

  @cds.persistence.exists
  entity CustomFields {
    key ID          : String(36);
        ifName      : String(200);
        sourceTable : String(60);
        sourceField : String(60);
        sourceDesc  : String(500);
        targetTable : String(60);
        targetField : String(60);
        targetDesc  : String(500);
        notes       : String(1000);
        isActive    : Integer;
  }
}

// ── CAP-managed tables ────────────────────────────────────────────────────────

entity PromptTemplates : cuid {
    language   : String(5)      not null;
    step       : String(30)     not null;
    promptType : String(20)     not null;
    content    : LargeString    not null;
    version    : Integer        default 1;
    isActive   : Boolean        default true;
    updatedAt  : Timestamp      @cds.on.insert: $now  @cds.on.update: $now;
}

entity TokenLogs : cuid {
    requestId    : String(36)   not null;
    provider     : String(20)   not null;
    step         : String(30)   not null;
    inputTokens  : Integer      not null;
    outputTokens : Integer      not null;
    createdAt    : Timestamp    @cds.on.insert: $now;
}

// ── Action payload types ──────────────────────────────────────────────────────

type InterfaceFieldInput {
    rowIndex    : Integer;
    module      : String(100);
    ifName      : String(200);
    ifDesc      : String(500);
    fieldName   : String(200);
    fieldText   : String(500);
    sampleValue : String(500);
    remark      : String(500);
}

type MatchedFieldResult {
    rowIndex    : Integer;
    tableId     : String(60);
    fieldId     : String(60);
    dataType    : String(30);
    fieldText   : String(500);
    matchScore  : Decimal(5,4);
    matchSource : String(20);
    notes       : String(1000);
    verified    : Boolean;
}

type CustomFieldUploadInput {
    ifName      : String(200);
    sourceDesc  : String(500);
    sourceTable : String(60);
    sourceField : String(60);
    targetDesc  : String(500);
    targetTable : String(60);
    targetField : String(60);
    notes       : String(1000);
}

type UploadResult {
    inserted : Integer;
    updated  : Integer;
    deleted  : Integer;
}
