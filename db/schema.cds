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
  entity TerminologyMapping {
    key ID              : String(36);
        sourceTerm      : String(200);
        sourceTermAlias : String(500);
        sourceContext   : String(1000);
        targetTerm      : String(200);
        targetTermAlias : String(500);
        sapModule       : String(50);
        sapTransaction  : String(20);
        sapObjectType   : String(50);
        sapTechnicalName: String(100);
        category        : String(50);
        domainArea      : String(50);
        priority        : Integer;
        confidence      : Decimal(3,2);
        status          : String(20);
        language        : String(10);
  }

  @cds.persistence.exists
  entity CustomFields {
    key ID               : String(36);
        scenario         : String(200);
        ifName           : String(200);
        sourceTable      : String(60);
        sourceField      : String(60);
        sourceDesc       : String(500);
        sourceType       : String(30);
        sourceLength     : Integer;
        sourceDecimals   : Integer;
        targetTable      : String(60);
        targetField      : String(60);
        targetDesc       : String(500);
        targetType       : String(30);
        targetLength     : Integer;
        targetDecimals   : Integer;
        keyFlag          : String(1);
        obligatory       : String(1);
        allowedValues    : String(500);
        allowedValuesDesc: String(500);
        class1           : String(100);
        class2           : String(100);
        class3           : String(100);
        isAppend         : String(10);
        notes            : String(1000);
        color            : String(7);
        isActive         : Integer;
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
    tableId     : String(200);
    fieldId     : String(200);
    keyFlag     : String(10);
    obligatory  : String(10);
    dataType    : String(30);
    lengthTotal : String(10);
    lengthDec   : String(10);
    isAppend    : String(10);
    verify      : String(10);
}

type MatchedFieldResult {
    rowIndex    : Integer;
    tableId     : String(200);
    fieldId     : String(60);
    dataType    : String(30);
    fieldText   : String(500);
    matchScore  : Decimal(5,4);
    matchSource : String(20);
    notes       : String(2000);
    verified    : Boolean;
    obligatory  : String(1);
    sampleValue : String(500);
    keyFlag     : String(1);
    lengthTotal : String(10);
    lengthDec   : String(10);
    color       : String(7);
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
    color       : String(7);
}

type UploadResult {
    inserted : Integer;
    updated  : Integer;
    deleted  : Integer;
}
