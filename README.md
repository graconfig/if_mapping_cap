# IF Mapping CAP Service

SAP interface field mapping service built with CAP Node.js/TypeScript. Matches SAP source fields (e.g. `EKPO-MATNR`) against CDS view fields using a 4-step AI-assisted pipeline backed by SAP AI Core and HANA Cloud vector search.

---

## Architecture

```
POST /if-mapping/match
        │
        ▼
   Orchestrator
   ┌─────────────────────────────────────────────┐
   │  Step 1  Custom-field exact/fuzzy lookup    │
   │  Step 2  AI view selection (CDS candidates) │
   │  Step 3  AI field-level matching            │
   │  Step 4  OData verification (optional)      │
   └─────────────────────────────────────────────┘
        │
        ▼
   MatchedFieldResult[]
```

| Layer | Path | Responsibility |
|-------|------|---------------|
| Service handler | `srv/if-mapping-service.ts` | CAP action wiring, error handling |
| Orchestrator | `srv/matching/orchestrator.ts` | Pipeline coordination |
| Step 1 | `srv/matching/step1-custom-fields.ts` | Custom-field knowledge base lookup |
| Step 2 | `srv/matching/step2-view-selection.ts` | AI-assisted CDS view selection |
| Step 3 | `srv/matching/step3-field-matching.ts` | AI field-level matching |
| Step 4 | `srv/matching/step4-odata-verify.ts` | OData metadata verification |
| AI client | `srv/ai/aicore-client.ts` | SAP AI Core LLM calls |
| Prompt manager | `srv/ai/prompt-manager.ts` | Prompt template caching |
| HANA repository | `srv/repository/hana-repository.ts` | HANA Cloud data access |

---

## Prerequisites

- Node.js ≥ 20
- `@sap/cds-dk` installed globally (`npm i -g @sap/cds-dk`)
- SAP AI Core instance with access to Claude / GPT-4o / Gemini
- SAP HANA Cloud instance with CDS view catalog tables

---

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

Required variables:

| Variable | Description |
|----------|-------------|
| `AICORE_AUTH_URL` | AI Core OAuth2 token URL |
| `AICORE_CLIENT_ID` | AI Core client ID |
| `AICORE_CLIENT_SECRET` | AI Core client secret |
| `AICORE_BASE_URL` | AI Core inference base URL |
| `AICORE_RESOURCE_GROUP` | AI Core resource group (default: `default`) |
| `HANA_ADDRESS` | HANA Cloud host |
| `HANA_PORT` | HANA Cloud port (default: `443`) |
| `HANA_USER` | HANA user |
| `HANA_PASSWORD` | HANA password |
| `HANA_SCHEMA` | Schema containing `CDS_VIEWS` / `VIEW_FIELDS` tables |
| `HANA_SCHEMA_CUST` | Schema containing `CUSTOM_FIELDS` table |

Optional tuning variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `CLAUDE_LLM_MODEL` | `anthropic--claude-4.5-sonnet` | Claude model ID in AI Core |
| `OPENAI_LLM_MODEL` | `gpt-4o` | OpenAI model ID |
| `GEMINI_LLM_MODEL` | `gemini-1.5-pro` | Gemini model ID |
| `TEXT_EMBEDDING_MODEL` | `text-embedding-ada-002` | Embedding model for vector search |
| `CUSTOM_FIELD_THRESHOLD` | `0.75` | Minimum similarity score for custom-field exact match |
| `MATCH_NUMBER` | `3` | Top-N candidates returned per field |
| `LLM_BATCH_SIZE` | `30` | Fields per AI batch call |
| `LLM_MAX_WORKERS` | `5` | Concurrent AI batch workers |
| `VERIFY_FLAG` | `false` | Enable OData verification step |
| `ODATA_URL` | — | SAP OData service URL for verification |
| `ODATA_USER` | — | OData basic auth user |
| `ODATA_PASSWORD` | — | OData basic auth password |

---

## Running

### Development (hot reload)

```bash
npm run dev
```

Service starts at `http://localhost:4004`.

### Production

```bash
npm start
```

---

## API

### `POST /if-mapping/match`

Run the field-matching pipeline.

**Request body:**

```json
{
  "fields": [
    {
      "rowIndex": 1,
      "sourceField": "EKPO-MATNR",
      "sourceDesc": "品目コード",
      "sourceTable": "EKPO"
    }
  ],
  "provider": "claude",
  "language": "ja"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `fields` | array | Yes | Source fields to match |
| `fields[].sourceField` | string | Yes | SAP field name |
| `fields[].sourceDesc` | string | Yes | Field description |
| `fields[].sourceTable` | string | No | SAP table name |
| `fields[].rowIndex` | integer | Yes | Row index for result correlation |
| `provider` | string | No | `claude` \| `openai` \| `gemini` (default: `claude`) |
| `language` | string | No | `ja` \| `en` \| `zh` (default: `ja`) |

**Response:**

```json
[
  {
    "rowIndex": 1,
    "tableId": "C_PurchaseOrderItemTP",
    "fieldId": "Material",
    "dataType": "Edm.String",
    "fieldText": "品目",
    "matchScore": 0.97,
    "matchSource": "custom",
    "verified": false
  }
]
```

`matchSource` values: `custom` (Step 1) · `ai` (Steps 2–3) · `odata` (Step 4)

---

### `POST /if-mapping/uploadCustomFields`

Upload the custom-field knowledge base.

**Request body:**

```json
{
  "records": [
    {
      "sourceField": "MATNR",
      "sourceDesc": "品目コード",
      "sourceTable": "EKPO",
      "targetField": "Material",
      "targetTable": "C_PurchaseOrderItemTP"
    }
  ],
  "mode": "upsert"
}
```

`mode`: `upsert` (insert new + update existing) | `overwrite` (replace all)

**Response:** `{ "inserted": N, "updated": N, "deleted": N }`

---

### `GET /if-mapping/PromptTemplates`

List prompt templates. Supports OData `$filter`, e.g.:

```
GET /if-mapping/PromptTemplates?$filter=language eq 'ja'
```

### `PATCH /if-mapping/PromptTemplates('{id}')`

Update a prompt template's content.

```json
{ "content": "新しいプロンプト内容..." }
```

### `POST /if-mapping/reloadPrompts`

Reload prompt templates from the database into the server-side cache. Call after editing templates via PATCH.

### `GET /if-mapping/TokenLogs`

List AI token usage logs. Fields: `provider`, `step`, `inputTokens`, `outputTokens`, `createdAt`.

---

## Database

| Table | Source | Description |
|-------|--------|-------------|
| `external.CdsViews` | External HANA (read-only) | CDS view catalog |
| `external.ViewFields` | External HANA (read-only) | CDS view field catalog |
| `external.CustomFields` | External HANA (managed) | Custom-field knowledge base |
| `PromptTemplates` | CAP-managed | AI prompt templates (multi-language) |
| `TokenLogs` | CAP-managed | AI token usage audit log |

In development, CAP uses SQLite (`db/dev.db`). In production, HANA Cloud is required.

---

## Testing

```bash
# Run all tests
npm test

# Watch mode
npm run test:watch
```

Test files are in `tests/`. The test environment uses SQLite in-memory (`":memory:"`).

---

## Project Structure

```
if_mapping_cap/
├── db/
│   └── schema.cds              # Entity definitions
├── srv/
│   ├── if-mapping-service.ts   # CAP service handler
│   ├── ai/
│   │   ├── aicore-client.ts    # SAP AI Core LLM client
│   │   └── prompt-manager.ts   # Prompt template cache
│   ├── matching/
│   │   ├── orchestrator.ts     # Pipeline coordinator
│   │   ├── step1-custom-fields.ts
│   │   ├── step2-view-selection.ts
│   │   ├── step3-field-matching.ts
│   │   └── step4-odata-verify.ts
│   ├── repository/
│   │   └── hana-repository.ts  # HANA Cloud data access
│   └── utils/
│       ├── config.ts           # Request config builder
│       ├── errors.ts           # AppError class
│       ├── logger.ts           # Structured logger
│       └── token-tracker.ts    # Token usage recorder
├── tests/                      # Jest test suite
├── .env.example                # Environment variable template
├── .cdsrc.json                 # CAP configuration
├── package.json
└── tsconfig.json
```
