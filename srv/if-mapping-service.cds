using {
  external,
  PromptTemplates as db_PromptTemplates,
  TokenLogs       as db_TokenLogs,
  InterfaceFieldInput,
  MatchedFieldResult,
  CustomFieldUploadInput,
  UploadResult
} from '../db/schema';

service IfMappingService @(path: '/if-mapping') {

  // Core matching action
  action match(
    fields   : array of InterfaceFieldInput,
    provider : String(20),
    language : String(5)
  ) returns array of MatchedFieldResult;

  // Knowledge base upload
  action uploadCustomFields(
    records : array of CustomFieldUploadInput,
    mode    : String(10)
  ) returns UploadResult;

  // Read-only lookups for debugging / admin
  @readonly entity CdsViews   as projection on external.CdsViews;
  @readonly entity ViewFields as projection on external.ViewFields;

  // Prompt template management (full CRUD)
  entity PromptTemplates as projection on db_PromptTemplates;
  action reloadPrompts() returns { success : Boolean };

  // Token usage read-only
  @readonly entity TokenLogs as projection on db_TokenLogs;
}
