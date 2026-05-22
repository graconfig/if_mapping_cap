# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development (hot reload via cds watch)
npm run dev

# Production
npm start

# Build (CAP compile + TypeScript type check — no emit)
npm run build

# Run all tests (sequentially, in-band)
npm test

# Run a single test file
npx jest tests/matching/step1-custom-fields.test.ts --runInBand

# Watch mode
npm run test:watch
```

Tests run against SQLite in-memory (`:memory:`) — no HANA connection needed. The `--runInBand` flag in `npm test` is intentional (tests share process state via CDS bootstrapping).

## Architecture

The service exposes a single CAP action `POST /if-mapping/match` that runs a 4-step pipeline to map SAP source fields (e.g. `EKPO-MATNR`) to CDS view fields.

### Pipeline flow

```
POST /if-mapping/match
  → if-mapping-service.ts     (CAP action wiring, error handling)
  → orchestrator.ts           (pipeline coordination)
    ├─ step1-custom-fields.ts  (exact match by sourceField, then vector similarity on custom KB)
    ├─ step2-view-selection.ts (AI selects candidate CDS views from HANA vector search results)
    ├─ step3-field-matching.ts (AI picks the best field within selected views)
    └─ step4-odata-verify.ts   (optional OData metadata verification, gated by VERIFY_FLAG)
```

Unmatched fields from Step 1 flow into Steps 2–3. Step 4 is optional and runs on all matched results when `VERIFY_FLAG=true`.

### Key design points

- **`OrchestratorDeps`** (`orchestrator.ts`) is the dependency injection interface — `HanaRepository`, `AiCoreClient`, and `PromptManager` are injected at the service layer and passed down, making all steps unit-testable with mocks.
- **`runInBatches`** (exported from `orchestrator.ts`) controls concurrency for AI calls: `LLM_BATCH_SIZE` fields per batch, up to `LLM_MAX_WORKERS` concurrent batches.
- **`AiCoreClient`** always uses tool-use mode (`tool_choice: { type: 'any' }`). The Anthropic Bedrock-compatible API format is used regardless of provider (`claude`/`openai`/`gemini`). The `provider` field in requests maps to a deployment path prefix but currently all go to the same endpoint.
- **`PromptManager`** loads templates from the `PromptTemplates` CAP-managed table at bootstrap and caches them by `step::language::promptType` key. Templates can be edited via `PATCH /if-mapping/PromptTemplates` and reloaded via `POST /if-mapping/reloadPrompts`.
- **`HanaRepository`** connects directly to HANA Cloud via `@sap/hana-client` (not through CAP's db layer). The external tables (`CdsViews`, `ViewFields`, `CustomFields`) are marked `@cds.persistence.exists` — CAP does not manage their DDL. Table names are hardcoded as `PWC_HAND_AI2REPORT_DEV_*` in the repository.
- **`InterfaceFieldInput`** (the TypeScript interface in `step1-custom-fields.ts`) is the authoritative type for pipeline inputs — it differs from the CDS `type InterfaceFieldInput` in `schema.cds` (CDS type has `sourceField`/`sourceTable`; TS interface has `fieldName`/`fieldText` etc.). The CDS type is for OData surface only.

### Configuration

All runtime config comes from env vars via `buildRequestConfig()` in `srv/utils/config.ts`. Defaults: `provider=claude`, `language=ja`, `batchSize=30`, `maxWorkers=5`, `vectorThreshold=0.75`, `matchNumber=3`, `verifyFlag=false`.

In Cloud Foundry, `VCAP_SERVICES` is parsed automatically in `HanaRepository` — env vars are the fallback.

### Database environments

| Env | DB | Notes |
|-----|----|-------|
| development | SQLite (`db/dev.db`) | CAP-managed tables only; HANA calls are mocked in tests |
| test | SQLite (`:memory:`) | Set by `.cdsrc.json` `[test]` profile |
| production | HANA Cloud | Full HANA connection required |
