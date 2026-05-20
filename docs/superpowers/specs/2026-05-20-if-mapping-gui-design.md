# IF Mapping GUI — Design Spec

**Date:** 2026-05-20  
**Status:** Approved  
**Project:** `if_mapping_gui/` (separate Python repo, sibling to `if_mapping_cap/`)

---

## Overview

A local desktop GUI for business users and consultants to drive the `if_mapping_cap` CAP service without needing a terminal. Built with Python + CustomTkinter, communicates with the CAP backend via OData HTTP, and reads/writes Excel files with openpyxl.

**Target users:** Business users and consultants (non-developers)  
**Deployment:** Local machine (Windows), runs alongside a local or remote CAP server  
**Tech stack:** Python 3.10+, CustomTkinter, openpyxl, requests

---

## Project Structure

```
if_mapping_gui/
├── gui_main.py            # Entry point — creates App and calls mainloop()
├── config.py              # Read/write config.json (server_url, provider, language, last_input_dir)
├── config.example.json    # Template for first-run setup
├── requirements.txt
├── gui/
│   ├── app.py             # CTk main window + sidebar navigation
│   └── frames/
│       ├── match_frame.py    # Field matching workflow
│       ├── upload_frame.py   # Upload custom fields knowledge base
│       ├── prompts_frame.py  # View and edit prompt templates
│       ├── logs_frame.py     # Token usage log viewer
│       └── settings_frame.py # CAP URL, default provider/language
├── api/
│   └── cap_client.py      # HTTP calls to CAP OData endpoints
└── excel/
    ├── reader.py           # Parse input Excel → list[InterfaceFieldInput]
    └── writer.py           # Write match results → output Excel
```

**Config persistence (`config.json`):**
```json
{
  "server_url": "http://localhost:4004",
  "provider": "claude",
  "language": "ja",
  "last_input_dir": "C:/..."
}
```
Config is auto-saved on every change; window state restores on relaunch.

---

## Layout

**Vertical layout (Option A):** Fixed 160px sidebar on the left, adaptive main content area on the right.

**Sidebar items (top to bottom):**
1. ▶ 字段匹配 (match_frame) — default active
2. ⬆ 上传知识库 (upload_frame)
3. 📝 Prompt 管理 (prompts_frame)
4. 📊 Token 日志 (logs_frame)
5. ⚙ 设置 (settings_frame) — pinned to bottom

**Status bar (always-visible footer):**
- Connection indicator (green dot = connected, red dot = disconnected)
- Current server URL
- Active provider and language
- App version

---

## Frame Designs

### ① match_frame — Field Matching

Flow (top to bottom):
1. **Drop zone** — drag-and-drop or click to select `.xlsx`/`.xls` files (multi-select)
2. **File list** — each file shows filename, row count badge, and ✕ remove button
3. **Options row** — AI Provider dropdown, Language dropdown, Start button, Stop button
4. **Progress bar** — gradient fill, turns orange on user-stopped
5. **Log area** — real-time monospace log with color-coded levels (green=INFO, amber=WARN, red=ERROR, blue=step highlights)
6. **Result + export bar** — summary stats (total / exact / vector / AI counts) + "导出结果 Excel" button

### ② upload_frame — Knowledge Base Upload

1. Drop zone for knowledge base Excel
2. Upload mode dropdown: Upsert (append/update) or Overwrite (replace all)
3. Upload button
4. Log area showing insert/update/delete counts on completion

### ③ prompts_frame — Prompt Template Management

Split layout:
- **Left panel (200px):** Language filter chips (JA / EN / ZH) + scrollable list of `{step} / {type}` entries; active entry highlighted
- **Right panel:** Editable text area for selected prompt content + Save / Cancel / Reload buttons

Reload calls `POST /if-mapping/reloadPrompts` to refresh the server-side cache.

### ④ logs_frame — Token Usage Log

1. Summary chips: total input tokens, total output tokens, call count + Refresh button
2. Table: timestamp | provider | step | input tokens | output tokens

### ⑤ settings_frame — Connection & Defaults

1. CAP service URL input + Test Connection button + connection status indicator
2. Default Provider dropdown
3. Default Language dropdown
4. Save Settings button

---

## Threading Model

Every long-running operation (matching, upload) runs in a `threading.Thread(daemon=True)`. The worker thread communicates with the GUI exclusively via a `queue.Queue`. The main thread polls the queue every 100ms using CustomTkinter's `after()` method.

**Message types the worker puts on the queue:**

| type | payload | GUI action |
|------|---------|-----------|
| `log` | `text`, `level` | Append line to log area |
| `progress` | `pct` (0–1) | Update progress bar |
| `done` | `results` | Show stats, enable Export button |
| `error` | `msg` | Show error in log (red), re-enable Start button |

**Concurrency limit:** Only one matching/upload task runs at a time. The Start/Upload button is disabled while a task is active. A `threading.Event` stop_event is checked periodically by the worker; the Stop button sets it.

---

## Error Handling

| Scenario | Behaviour |
|----------|-----------|
| CAP service not running | Pre-flight ping before job starts; immediate abort with log error and dialog |
| Excel missing required columns | Skip that file; log error with column diff; continue other files |
| Single field AI call fails (rate limit, timeout) | Mark field as `matchType=unmatched`; continue batch |
| User clicks Stop | Set stop_event; worker exits after current batch; partial results exportable; progress bar turns orange |
| Upload fails mid-way | Log error; show partial counts if available |

---

## CAP API Mapping

| Frame | CAP endpoint |
|-------|-------------|
| match_frame | `POST /if-mapping/match` |
| upload_frame | `POST /if-mapping/uploadCustomFields` |
| prompts_frame (read) | `GET /if-mapping/PromptTemplates` |
| prompts_frame (save) | `PATCH /if-mapping/PromptTemplates({id})` |
| prompts_frame (reload) | `POST /if-mapping/reloadPrompts` |
| logs_frame | `GET /if-mapping/TokenLogs` |

All calls go through `api/cap_client.py` which reads `server_url` from config, sets a 30-second timeout, and raises a `CapConnectionError` on network failure.

---

## Excel Formats

### Input columns (case-insensitive, alias-aware)

| Column | Aliases | Required |
|--------|---------|----------|
| `sourceField` | `field_name`, `フィールド名` | Yes |
| `sourceDesc` | `description`, `説明`, `描述` | Yes |
| `sourceTable` | `table_name`, `テーブル名` | No |

`rowIndex` is auto-generated from the Excel row number; no user input needed. Column names are stripped and lowercased before matching. Missing required columns cause the file to be skipped with an error log entry.

### Output columns

Original input columns are preserved as-is. The following columns are appended:

| Column | Values |
|--------|--------|
| `targetField` | Matched CDS field name |
| `targetEntity` | Matched CDS view/entity name |
| `matchType` | `exact` / `vector` / `ai` / `unmatched` |
| `confidence` | Float 0–1 |
| `aiReason` | AI explanation string (empty for exact/vector) |

**File naming:** `{original_filename}_matched_{YYYYMMDD}_{HHMMSS}.xlsx`  
Each input file gets its own output file. Output is saved to the same directory as the input file by default; a Save dialog allows changing the location.

---

## Out of Scope

- Packaging as a standalone `.exe` (can be added later with PyInstaller)
- Authentication / API key UI (keys managed server-side in CAP)
- Result editing within the GUI (export → edit in Excel)
- BTP CF deployment of the GUI itself
