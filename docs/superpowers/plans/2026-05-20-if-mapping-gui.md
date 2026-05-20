# IF Mapping GUI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Python/CustomTkinter desktop GUI at `d:/Users/PC/Projects/if_mapping_gui/` that lets business users run field matching, upload knowledge bases, manage prompts, and view token logs against a running `if_mapping_cap` CAP service.

**Architecture:** Separate Python project (`if_mapping_gui/`) with three layers — `api/` (HTTP client), `excel/` (file I/O), and `gui/` (CTk frames). Long-running operations run in `threading.Thread(daemon=True)` and communicate back to the GUI via `queue.Queue` polled with `after(100, ...)`. Config persists in `config.json` beside the entry point.

**Tech Stack:** Python 3.10+, customtkinter 5.x, openpyxl 3.x, requests 2.x, pytest 8.x

---

## File Map

| File | Responsibility |
|------|---------------|
| `if_mapping_gui/config.py` | Load/save `config.json`; expose typed defaults |
| `if_mapping_gui/api/cap_client.py` | All HTTP calls to CAP; raises `CapConnectionError` |
| `if_mapping_gui/excel/reader.py` | Parse xlsx → `InterfaceFieldInput` list; alias-aware header mapping |
| `if_mapping_gui/excel/writer.py` | Write matched results → `*_matched_YYYYMMDD_HHMMSS.xlsx` |
| `if_mapping_gui/gui/app.py` | CTk main window, sidebar nav, status bar, frame switching |
| `if_mapping_gui/gui/frames/settings_frame.py` | CAP URL + test connection + defaults + save |
| `if_mapping_gui/gui/frames/match_frame.py` | Full match workflow (UI + worker thread) |
| `if_mapping_gui/gui/frames/upload_frame.py` | Upload knowledge base Excel (UI + worker) |
| `if_mapping_gui/gui/frames/prompts_frame.py` | List + edit prompt templates |
| `if_mapping_gui/gui/frames/logs_frame.py` | Token usage summary + table |
| `if_mapping_gui/gui_main.py` | Entry point |
| `if_mapping_gui/tests/test_config.py` | Unit tests for config module |
| `if_mapping_gui/tests/test_cap_client.py` | Unit tests for CAP HTTP client |
| `if_mapping_gui/tests/test_excel_reader.py` | Unit tests for Excel parsing |
| `if_mapping_gui/tests/test_excel_writer.py` | Unit tests for Excel writing |
| `if_mapping_gui/tests/test_app_smoke.py` | GUI smoke tests (Windows only) |

---

## Task 1: Project Scaffolding

**Files:**
- Create: `d:/Users/PC/Projects/if_mapping_gui/` (all dirs and root files)

- [ ] **Step 1: Create directory structure**

```bash
mkdir -p d:/Users/PC/Projects/if_mapping_gui/api
mkdir -p d:/Users/PC/Projects/if_mapping_gui/excel
mkdir -p d:/Users/PC/Projects/if_mapping_gui/gui/frames
mkdir -p d:/Users/PC/Projects/if_mapping_gui/tests
```

- [ ] **Step 2: Create `requirements.txt`**

```
# d:/Users/PC/Projects/if_mapping_gui/requirements.txt
customtkinter>=5.2.0
openpyxl>=3.1.0
requests>=2.31.0
pytest>=8.0.0
pytest-mock>=3.12.0
```

- [ ] **Step 3: Create `config.example.json`**

```json
{
  "server_url": "http://localhost:4004",
  "provider": "claude",
  "language": "ja",
  "last_input_dir": ""
}
```

- [ ] **Step 4: Create `__init__.py` files**

Create empty `__init__.py` in: `api/`, `excel/`, `gui/`, `gui/frames/`, `tests/`

- [ ] **Step 5: Create `pytest.ini`**

```ini
# d:/Users/PC/Projects/if_mapping_gui/pytest.ini
[pytest]
testpaths = tests
```

- [ ] **Step 6: Install dependencies**

```bash
cd d:/Users/PC/Projects/if_mapping_gui
pip install -r requirements.txt
```

Expected: all packages install without error.

- [ ] **Step 7: Commit**

```bash
cd d:/Users/PC/Projects/if_mapping_gui
git init
git add .
git commit -m "chore: scaffold if_mapping_gui project"
```

---

## Task 2: Config Module

**Files:**
- Create: `if_mapping_gui/config.py`
- Create: `if_mapping_gui/tests/test_config.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/test_config.py
import json
from pathlib import Path
import pytest
import config

@pytest.fixture(autouse=True)
def isolated_config(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "CONFIG_PATH", tmp_path / "config.json")

def test_load_returns_defaults_when_no_file():
    cfg = config.load()
    assert cfg["server_url"] == "http://localhost:4004"
    assert cfg["provider"] == "claude"
    assert cfg["language"] == "ja"
    assert cfg["last_input_dir"] == ""

def test_load_merges_saved_values_with_defaults():
    config.CONFIG_PATH.write_text(json.dumps({"server_url": "http://myserver:4004"}))
    cfg = config.load()
    assert cfg["server_url"] == "http://myserver:4004"
    assert cfg["provider"] == "claude"  # default still present

def test_save_and_reload_roundtrip():
    cfg = config.load()
    cfg["language"] = "en"
    cfg["last_input_dir"] = "C:/files"
    config.save(cfg)
    reloaded = config.load()
    assert reloaded["language"] == "en"
    assert reloaded["last_input_dir"] == "C:/files"

def test_save_creates_file_if_missing():
    assert not config.CONFIG_PATH.exists()
    config.save(config.load())
    assert config.CONFIG_PATH.exists()
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd d:/Users/PC/Projects/if_mapping_gui
pytest tests/test_config.py -v
```

Expected: `ModuleNotFoundError: No module named 'config'`

- [ ] **Step 3: Implement `config.py`**

```python
# config.py
import json
from pathlib import Path

CONFIG_PATH = Path(__file__).parent / "config.json"

DEFAULTS: dict = {
    "server_url": "http://localhost:4004",
    "provider": "claude",
    "language": "ja",
    "last_input_dir": "",
}

def load() -> dict:
    if not CONFIG_PATH.exists():
        return dict(DEFAULTS)
    with CONFIG_PATH.open(encoding="utf-8") as f:
        data = json.load(f)
    return {**DEFAULTS, **data}

def save(cfg: dict) -> None:
    with CONFIG_PATH.open("w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2, ensure_ascii=False)
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pytest tests/test_config.py -v
```

Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add config.py tests/test_config.py
git commit -m "feat: add config module with load/save and defaults"
```

---

## Task 3: CAP HTTP Client

**Files:**
- Create: `if_mapping_gui/api/cap_client.py`
- Create: `if_mapping_gui/tests/test_cap_client.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/test_cap_client.py
import requests
import pytest
from unittest.mock import patch, MagicMock
from api.cap_client import CapClient, CapConnectionError

BASE = "http://localhost:4004"

def _mock_response(json_data=None, status=200):
    m = MagicMock()
    m.status_code = status
    m.json.return_value = json_data or {}
    m.raise_for_status = MagicMock()
    return m

def test_ping_true_when_service_responds():
    with patch("requests.get", return_value=_mock_response(status=200)):
        assert CapClient(BASE).ping() is True

def test_ping_false_on_connection_error():
    with patch("requests.get", side_effect=requests.ConnectionError()):
        assert CapClient(BASE).ping() is False

def test_ping_false_on_timeout():
    with patch("requests.get", side_effect=requests.Timeout()):
        assert CapClient(BASE).ping() is False

def test_match_posts_correct_payload_and_returns_results():
    results = [{"sourceField": "MATNR", "matchType": "exact", "targetField": "Material",
                "targetEntity": "C_PurchaseOrderItemTP", "confidence": 1.0, "aiReason": ""}]
    with patch("requests.post", return_value=_mock_response({"value": results})) as mock_post:
        client = CapClient(BASE)
        out = client.match(
            [{"sourceField": "MATNR", "sourceDesc": "Material No.", "sourceTable": "", "rowIndex": 2}],
            provider="claude", language="ja"
        )
    assert out == results
    mock_post.assert_called_once_with(
        f"{BASE}/if-mapping/match",
        json={
            "fields": [{"sourceField": "MATNR", "sourceDesc": "Material No.", "sourceTable": "", "rowIndex": 2}],
            "provider": "claude",
            "language": "ja",
        },
        timeout=30,
    )

def test_match_raises_cap_connection_error_on_http_error():
    mock_resp = _mock_response(status=500)
    mock_resp.raise_for_status.side_effect = requests.HTTPError("500")
    with patch("requests.post", return_value=mock_resp):
        with pytest.raises(CapConnectionError):
            CapClient(BASE).match([], "claude", "ja")

def test_upload_custom_fields_posts_and_returns_counts():
    counts = {"inserted": 10, "updated": 2, "deleted": 0}
    with patch("requests.post", return_value=_mock_response(counts)) as mock_post:
        out = CapClient(BASE).upload_custom_fields([{"sourceField": "X"}], mode="upsert")
    assert out == counts
    mock_post.assert_called_once_with(
        f"{BASE}/if-mapping/uploadCustomFields",
        json={"records": [{"sourceField": "X"}], "mode": "upsert"},
        timeout=30,
    )

def test_get_prompts_returns_list():
    prompts = [{"id": "1", "step": "field_matching", "language": "ja", "promptType": "user", "content": "..."}]
    with patch("requests.get", return_value=_mock_response({"value": prompts})):
        out = CapClient(BASE).get_prompts(language="ja")
    assert out == prompts

def test_patch_prompt_sends_content():
    updated = {"id": "1", "content": "new text"}
    with patch("requests.patch", return_value=_mock_response(updated)) as mock_patch:
        out = CapClient(BASE).patch_prompt("1", "new text")
    assert out == updated
    mock_patch.assert_called_once_with(
        f"{BASE}/if-mapping/PromptTemplates('1')",
        json={"content": "new text"},
        timeout=30,
    )

def test_reload_prompts_posts_to_endpoint():
    with patch("requests.post", return_value=_mock_response()) as mock_post:
        CapClient(BASE).reload_prompts()
    mock_post.assert_called_once_with(f"{BASE}/if-mapping/reloadPrompts", timeout=30)

def test_get_token_logs_returns_list():
    logs = [{"timestamp": "14:32:04", "provider": "claude", "step": "field_matching",
             "inputTokens": 523, "outputTokens": 48}]
    with patch("requests.get", return_value=_mock_response({"value": logs})):
        out = CapClient(BASE).get_token_logs()
    assert out == logs
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/test_cap_client.py -v
```

Expected: `ModuleNotFoundError: No module named 'api.cap_client'`

- [ ] **Step 3: Implement `api/cap_client.py`**

```python
# api/cap_client.py
import requests


class CapConnectionError(Exception):
    pass


class CapClient:
    def __init__(self, server_url: str, timeout: int = 30):
        self.base = server_url.rstrip("/") + "/if-mapping"
        self.timeout = timeout

    def ping(self) -> bool:
        try:
            r = requests.get(self.base, timeout=5)
            return r.status_code < 500
        except requests.RequestException:
            return False

    def match(self, fields: list[dict], provider: str, language: str) -> list[dict]:
        try:
            r = requests.post(
                f"{self.base}/match",
                json={"fields": fields, "provider": provider, "language": language},
                timeout=self.timeout,
            )
            r.raise_for_status()
            return r.json().get("value", [])
        except requests.HTTPError as e:
            raise CapConnectionError(str(e)) from e

    def upload_custom_fields(self, records: list[dict], mode: str = "upsert") -> dict:
        try:
            r = requests.post(
                f"{self.base}/uploadCustomFields",
                json={"records": records, "mode": mode},
                timeout=self.timeout,
            )
            r.raise_for_status()
            return r.json()
        except requests.HTTPError as e:
            raise CapConnectionError(str(e)) from e

    def get_prompts(self, language: str | None = None) -> list[dict]:
        params = {}
        if language:
            params["$filter"] = f"language eq '{language}'"
        r = requests.get(f"{self.base}/PromptTemplates", params=params, timeout=self.timeout)
        r.raise_for_status()
        return r.json().get("value", [])

    def patch_prompt(self, prompt_id: str, content: str) -> dict:
        r = requests.patch(
            f"{self.base}/PromptTemplates('{prompt_id}')",
            json={"content": content},
            timeout=self.timeout,
        )
        r.raise_for_status()
        return r.json()

    def reload_prompts(self) -> None:
        r = requests.post(f"{self.base}/reloadPrompts", timeout=self.timeout)
        r.raise_for_status()

    def get_token_logs(self) -> list[dict]:
        r = requests.get(f"{self.base}/TokenLogs", timeout=self.timeout)
        r.raise_for_status()
        return r.json().get("value", [])
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pytest tests/test_cap_client.py -v
```

Expected: 9 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add api/cap_client.py tests/test_cap_client.py
git commit -m "feat: add CAP HTTP client with all endpoints"
```

---

## Task 4: Excel Reader

**Files:**
- Create: `if_mapping_gui/excel/reader.py`
- Create: `if_mapping_gui/tests/test_excel_reader.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/test_excel_reader.py
import pytest
import openpyxl
from pathlib import Path
from excel.reader import read_fields, InterfaceFieldInput, ExcelReadError

def _make_xlsx(tmp_path, headers: list, rows: list[list]) -> Path:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(headers)
    for row in rows:
        ws.append(row)
    path = tmp_path / "test.xlsx"
    wb.save(path)
    return path

def test_reads_standard_columns(tmp_path):
    path = _make_xlsx(tmp_path,
        ["sourceField", "sourceDesc", "sourceTable"],
        [["EKPO-MATNR", "品目コード", "EKPO"], ["EKKO-BUKRS", "会社コード", "EKKO"]],
    )
    fields, raw = read_fields(path)
    assert len(fields) == 2
    assert fields[0].sourceField == "EKPO-MATNR"
    assert fields[0].sourceDesc == "品目コード"
    assert fields[0].sourceTable == "EKPO"
    assert fields[0].rowIndex == 2
    assert fields[1].rowIndex == 3

def test_reads_alias_columns(tmp_path):
    path = _make_xlsx(tmp_path,
        ["field_name", "description"],
        [["MARA-MATNR", "Material No."]],
    )
    fields, _ = read_fields(path)
    assert fields[0].sourceField == "MARA-MATNR"
    assert fields[0].sourceDesc == "Material No."

def test_reads_japanese_alias_columns(tmp_path):
    path = _make_xlsx(tmp_path,
        ["フィールド名", "説明", "テーブル名"],
        [["MARC-WERKS", "プラント", "MARC"]],
    )
    fields, _ = read_fields(path)
    assert fields[0].sourceField == "MARC-WERKS"
    assert fields[0].sourceTable == "MARC"

def test_sourcetable_optional(tmp_path):
    path = _make_xlsx(tmp_path,
        ["sourceField", "sourceDesc"],
        [["MARA-MATNR", "Material"]],
    )
    fields, _ = read_fields(path)
    assert fields[0].sourceTable == ""

def test_skips_blank_rows(tmp_path):
    path = _make_xlsx(tmp_path,
        ["sourceField", "sourceDesc"],
        [["MATNR", "Material"], [None, None], ["WERKS", "Plant"]],
    )
    fields, _ = read_fields(path)
    assert len(fields) == 2
    assert fields[1].sourceField == "WERKS"

def test_raises_on_missing_sourcefield(tmp_path):
    path = _make_xlsx(tmp_path, ["sourceDesc"], [["Material"]])
    with pytest.raises(ExcelReadError, match="sourceField"):
        read_fields(path)

def test_raises_on_missing_sourcedesc(tmp_path):
    path = _make_xlsx(tmp_path, ["sourceField"], [["MATNR"]])
    with pytest.raises(ExcelReadError, match="sourceDesc"):
        read_fields(path)

def test_raw_rows_preserve_original_headers(tmp_path):
    path = _make_xlsx(tmp_path,
        ["フィールド名", "説明"],
        [["MATNR", "Material"]],
    )
    _, raw = read_fields(path)
    assert raw[0]["フィールド名"] == "MATNR"
    assert "rowIndex" in raw[0]
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/test_excel_reader.py -v
```

Expected: `ModuleNotFoundError: No module named 'excel.reader'`

- [ ] **Step 3: Implement `excel/reader.py`**

```python
# excel/reader.py
import openpyxl
from pathlib import Path
from dataclasses import dataclass

COLUMN_ALIASES: dict[str, str] = {
    "sourcefield": "sourceField",
    "field_name": "sourceField",
    "フィールド名": "sourceField",
    "sourcedesc": "sourceDesc",
    "description": "sourceDesc",
    "説明": "sourceDesc",
    "描述": "sourceDesc",
    "sourcetable": "sourceTable",
    "table_name": "sourceTable",
    "テーブル名": "sourceTable",
}


@dataclass
class InterfaceFieldInput:
    sourceField: str
    sourceDesc: str
    rowIndex: int
    sourceTable: str = ""

    def to_dict(self) -> dict:
        return {
            "sourceField": self.sourceField,
            "sourceDesc": self.sourceDesc,
            "sourceTable": self.sourceTable,
            "rowIndex": self.rowIndex,
        }


class ExcelReadError(Exception):
    pass


def read_fields(path: Path) -> tuple[list[InterfaceFieldInput], list[dict]]:
    """Return (fields, raw_rows) where raw_rows preserve original header names."""
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb.active
    all_rows = list(ws.iter_rows(values_only=True))
    wb.close()

    if not all_rows:
        raise ExcelReadError(f"{path.name}: empty file")

    # Build column index map: canonical name → column index
    original_headers = [str(c).strip() if c is not None else "" for c in all_rows[0]]
    col_map: dict[str, int] = {}
    for i, h in enumerate(original_headers):
        canonical = COLUMN_ALIASES.get(h.lower(), h.lower())
        col_map[canonical] = i

    if "sourceField" not in col_map:
        raise ExcelReadError(f"{path.name}: missing required column 'sourceField' (got: {original_headers})")
    if "sourceDesc" not in col_map:
        raise ExcelReadError(f"{path.name}: missing required column 'sourceDesc' (got: {original_headers})")

    fields: list[InterfaceFieldInput] = []
    raw_rows: list[dict] = []

    for row_offset, row in enumerate(all_rows[1:], start=2):
        sf = row[col_map["sourceField"]] if col_map["sourceField"] < len(row) else None
        if not sf:
            continue
        sd = row[col_map["sourceDesc"]] if col_map["sourceDesc"] < len(row) else None
        st_idx = col_map.get("sourceTable")
        st = str(row[st_idx]).strip() if st_idx is not None and st_idx < len(row) and row[st_idx] else ""

        fields.append(InterfaceFieldInput(
            sourceField=str(sf).strip(),
            sourceDesc=str(sd).strip() if sd else "",
            rowIndex=row_offset,
            sourceTable=st,
        ))
        raw_row = {original_headers[i]: (str(v).strip() if v is not None else "") for i, v in enumerate(row)}
        raw_row["rowIndex"] = row_offset
        raw_rows.append(raw_row)

    return fields, raw_rows
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pytest tests/test_excel_reader.py -v
```

Expected: 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add excel/reader.py tests/test_excel_reader.py
git commit -m "feat: add Excel reader with alias-aware column mapping"
```

---

## Task 5: Excel Writer

**Files:**
- Create: `if_mapping_gui/excel/writer.py`
- Create: `if_mapping_gui/tests/test_excel_writer.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/test_excel_writer.py
import openpyxl
import pytest
from pathlib import Path
from excel.writer import write_results

def test_output_filename_contains_matched_and_timestamp(tmp_path):
    input_path = tmp_path / "IF_MM_001.xlsx"
    raw_rows = [{"sourceField": "MATNR", "sourceDesc": "Material", "rowIndex": 2}]
    results = [{"rowIndex": 2, "targetField": "Material", "targetEntity": "C_PurchaseOrderItemTP",
                "matchType": "exact", "confidence": 1.0, "aiReason": ""}]
    out = write_results(input_path, raw_rows, results)
    assert out.stem.startswith("IF_MM_001_matched_")
    assert out.suffix == ".xlsx"
    assert out.parent == tmp_path

def test_output_has_all_input_columns_plus_result_columns(tmp_path):
    input_path = tmp_path / "test.xlsx"
    raw_rows = [{"sourceField": "MATNR", "sourceDesc": "Material", "rowIndex": 2}]
    results = [{"rowIndex": 2, "targetField": "Material", "targetEntity": "CDS_View",
                "matchType": "ai", "confidence": 0.9, "aiReason": "名前が一致"}]
    out = write_results(input_path, raw_rows, results)
    wb = openpyxl.load_workbook(out)
    ws = wb.active
    headers = [ws.cell(1, c).value for c in range(1, ws.max_column + 1)]
    assert "sourceField" in headers
    assert "sourceDesc" in headers
    assert "targetField" in headers
    assert "targetEntity" in headers
    assert "matchType" in headers
    assert "confidence" in headers
    assert "aiReason" in headers

def test_output_data_row_values_are_correct(tmp_path):
    input_path = tmp_path / "test.xlsx"
    raw_rows = [{"sourceField": "MATNR", "sourceDesc": "Material", "rowIndex": 2}]
    results = [{"rowIndex": 2, "targetField": "Material", "targetEntity": "CDS_View",
                "matchType": "ai", "confidence": 0.9, "aiReason": "名前が一致"}]
    out = write_results(input_path, raw_rows, results)
    wb = openpyxl.load_workbook(out)
    ws = wb.active
    headers = [ws.cell(1, c).value for c in range(1, ws.max_column + 1)]
    data = {headers[c]: ws.cell(2, c + 1).value for c in range(len(headers))}
    assert data["sourceField"] == "MATNR"
    assert data["targetField"] == "Material"
    assert data["matchType"] == "ai"
    assert abs(data["confidence"] - 0.9) < 0.001
    assert data["aiReason"] == "名前が一致"

def test_unmatched_row_has_empty_result_columns(tmp_path):
    input_path = tmp_path / "test.xlsx"
    raw_rows = [{"sourceField": "UNKNOWN", "sourceDesc": "?", "rowIndex": 2}]
    results = [{"rowIndex": 2, "targetField": "", "targetEntity": "",
                "matchType": "unmatched", "confidence": 0.0, "aiReason": ""}]
    out = write_results(input_path, raw_rows, results)
    wb = openpyxl.load_workbook(out)
    ws = wb.active
    headers = [ws.cell(1, c).value for c in range(1, ws.max_column + 1)]
    match_type_col = headers.index("matchType") + 1
    assert ws.cell(2, match_type_col).value == "unmatched"
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/test_excel_writer.py -v
```

Expected: `ModuleNotFoundError: No module named 'excel.writer'`

- [ ] **Step 3: Implement `excel/writer.py`**

```python
# excel/writer.py
from datetime import datetime
from pathlib import Path

import openpyxl
from openpyxl.styles import Font

RESULT_COLS = ["targetField", "targetEntity", "matchType", "confidence", "aiReason"]


def write_results(input_path: Path, raw_rows: list[dict], results: list[dict]) -> Path:
    """Write match results to *_matched_YYYYMMDD_HHMMSS.xlsx beside the input file."""
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    out_path = input_path.parent / f"{input_path.stem}_matched_{ts}.xlsx"

    input_cols = [k for k in (raw_rows[0].keys() if raw_rows else []) if k != "rowIndex"]
    headers = input_cols + RESULT_COLS

    result_by_row: dict[int, dict] = {r.get("rowIndex", -1): r for r in results}

    wb = openpyxl.Workbook()
    ws = wb.active

    for col_i, h in enumerate(headers, start=1):
        cell = ws.cell(row=1, column=col_i, value=h)
        cell.font = Font(bold=True)

    for row_i, raw in enumerate(raw_rows, start=2):
        row_idx = raw.get("rowIndex", -1)
        matched = result_by_row.get(row_idx, {})
        for col_i, col in enumerate(input_cols, start=1):
            ws.cell(row=row_i, column=col_i, value=raw.get(col, ""))
        offset = len(input_cols)
        for col_i, col in enumerate(RESULT_COLS, start=offset + 1):
            ws.cell(row=row_i, column=col_i, value=matched.get(col, ""))

    wb.save(out_path)
    return out_path
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pytest tests/test_excel_writer.py -v
```

Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add excel/writer.py tests/test_excel_writer.py
git commit -m "feat: add Excel writer with matched output format"
```

---

## Task 6: GUI App Shell

**Files:**
- Create: `if_mapping_gui/gui/app.py`
- Create: `if_mapping_gui/tests/test_app_smoke.py`

- [ ] **Step 1: Write smoke test**

```python
# tests/test_app_smoke.py
import sys
import pytest

@pytest.mark.skipif(sys.platform != "win32", reason="GUI requires Windows display")
def test_app_creates_all_frames_and_destroys():
    from gui.app import App
    app = App()
    assert set(app._frames.keys()) == {"match", "upload", "prompts", "logs", "settings"}
    app.destroy()

@pytest.mark.skipif(sys.platform != "win32", reason="GUI requires Windows display")
def test_show_frame_raises_active_frame():
    from gui.app import App
    app = App()
    app.show_frame("settings")
    # No assertion needed — just verify no exception is raised
    app.destroy()
```

- [ ] **Step 2: Run smoke tests to verify they fail**

```bash
pytest tests/test_app_smoke.py -v
```

Expected: `ModuleNotFoundError: No module named 'gui.app'`

- [ ] **Step 3: Create stub base frame**

```python
# gui/frames/__init__.py
import customtkinter as ctk

class BaseFrame(ctk.CTkFrame):
    """Base class for all content frames."""
    def __init__(self, master, app, **kwargs):
        super().__init__(master, **kwargs)
        self.app = app
```

- [ ] **Step 4: Create stub frames (one import per file)**

Create `gui/frames/match_frame.py`:
```python
from gui.frames import BaseFrame
class MatchFrame(BaseFrame):
    pass
```

Create `gui/frames/upload_frame.py`:
```python
from gui.frames import BaseFrame
class UploadFrame(BaseFrame):
    pass
```

Create `gui/frames/prompts_frame.py`:
```python
from gui.frames import BaseFrame
class PromptsFrame(BaseFrame):
    pass
```

Create `gui/frames/logs_frame.py`:
```python
from gui.frames import BaseFrame
class LogsFrame(BaseFrame):
    pass
```

Create `gui/frames/settings_frame.py`:
```python
from gui.frames import BaseFrame
class SettingsFrame(BaseFrame):
    pass
```

- [ ] **Step 5: Implement `gui/app.py`**

```python
# gui/app.py
import customtkinter as ctk
import config
from gui.frames.match_frame import MatchFrame
from gui.frames.upload_frame import UploadFrame
from gui.frames.prompts_frame import PromptsFrame
from gui.frames.logs_frame import LogsFrame
from gui.frames.settings_frame import SettingsFrame
from api.cap_client import CapClient

ctk.set_appearance_mode("dark")
ctk.set_default_color_theme("blue")

_NAV_ITEMS = [
    ("match",   "▶  字段匹配"),
    ("upload",  "⬆  上传知识库"),
    ("prompts", "📝  Prompt 管理"),
    ("logs",    "📊  Token 日志"),
]


class App(ctk.CTk):
    def __init__(self):
        super().__init__()
        self.title("IF Mapping")
        self.geometry("920x640")
        self.cfg = config.load()

        self._build_layout()
        self.show_frame("match")
        self.after(500, self._refresh_status)

    def _build_layout(self):
        # Status bar must be packed FIRST so tkinter reserves bottom space before
        # the side="left" widgets consume all remaining area.
        self._statusbar = ctk.CTkFrame(self, height=28, corner_radius=0)
        self._statusbar.pack(side="bottom", fill="x")
        self._statusbar.pack_propagate(False)
        self._conn_label = ctk.CTkLabel(self._statusbar, text="● 检查中…", font=("", 11))
        self._conn_label.pack(side="left", padx=12)
        ctk.CTkLabel(self._statusbar, text="v0.1.0", font=("", 10)).pack(side="right", padx=12)

        # Sidebar
        self._sidebar = ctk.CTkFrame(self, width=164, corner_radius=0)
        self._sidebar.pack(side="left", fill="y")
        self._sidebar.pack_propagate(False)

        ctk.CTkLabel(self._sidebar, text="🔗 IF Mapping", font=("", 13, "bold")).pack(
            pady=(18, 14), padx=10
        )

        self._nav_btns: dict[str, ctk.CTkButton] = {}
        for key, label in _NAV_ITEMS:
            btn = ctk.CTkButton(
                self._sidebar, text=label, anchor="w", height=34,
                command=lambda k=key: self.show_frame(k),
            )
            btn.pack(fill="x", padx=8, pady=2)
            self._nav_btns[key] = btn

        settings_btn = ctk.CTkButton(
            self._sidebar, text="⚙  设置", anchor="w", height=34,
            command=lambda: self.show_frame("settings"),
        )
        settings_btn.pack(fill="x", padx=8, pady=2, side="bottom")
        self._nav_btns["settings"] = settings_btn

        # Main area
        self._main = ctk.CTkFrame(self, corner_radius=0)
        self._main.pack(side="left", fill="both", expand=True)

        self._frames: dict[str, ctk.CTkFrame] = {
            "match":    MatchFrame(self._main, self),
            "upload":   UploadFrame(self._main, self),
            "prompts":  PromptsFrame(self._main, self),
            "logs":     LogsFrame(self._main, self),
            "settings": SettingsFrame(self._main, self),
        }
        for frame in self._frames.values():
            frame.place(relx=0, rely=0, relwidth=1, relheight=1)


    def show_frame(self, name: str) -> None:
        self._frames[name].tkraise()
        for k, btn in self._nav_btns.items():
            btn.configure(fg_color=("#0f3460", "#0f3460") if k == name else "transparent")

    def update_status(self, connected: bool) -> None:
        url = self.cfg.get("server_url", "")
        if connected:
            self._conn_label.configure(text=f"●  {url}", text_color="#22c55e")
        else:
            self._conn_label.configure(text="●  未连接", text_color="#ef4444")

    def get_client(self) -> CapClient:
        return CapClient(self.cfg.get("server_url", "http://localhost:4004"))

    def _refresh_status(self) -> None:
        import threading
        def _check():
            ok = self.get_client().ping()
            self.after(0, lambda: self.update_status(ok))
        threading.Thread(target=_check, daemon=True).start()
        self.after(30_000, self._refresh_status)
```

- [ ] **Step 6: Run smoke tests to verify they pass**

```bash
pytest tests/test_app_smoke.py -v
```

Expected: 2 tests PASS (on Windows).

- [ ] **Step 7: Commit**

```bash
git add gui/ tests/test_app_smoke.py
git commit -m "feat: add GUI app shell with sidebar and frame switching"
```

---

## Task 7: settings_frame

**Files:**
- Modify: `if_mapping_gui/gui/frames/settings_frame.py` (replace stub)

- [ ] **Step 1: Implement `settings_frame.py`**

```python
# gui/frames/settings_frame.py
import threading
import customtkinter as ctk
import config
from gui.frames import BaseFrame


class SettingsFrame(BaseFrame):
    def __init__(self, master, app, **kwargs):
        super().__init__(master, app, **kwargs)
        self._build()

    def _build(self):
        pad = {"padx": 20, "pady": 8}
        ctk.CTkLabel(self, text="设置", font=("", 16, "bold")).pack(anchor="w", padx=20, pady=(20, 4))

        # CAP URL row
        url_frame = ctk.CTkFrame(self, fg_color="transparent")
        url_frame.pack(fill="x", **pad)
        ctk.CTkLabel(url_frame, text="CAP 服务地址", font=("", 11)).pack(anchor="w")
        row = ctk.CTkFrame(url_frame, fg_color="transparent")
        row.pack(fill="x")
        self._url_entry = ctk.CTkEntry(row, width=280)
        self._url_entry.insert(0, self.app.cfg.get("server_url", "http://localhost:4004"))
        self._url_entry.pack(side="left", padx=(0, 8))
        ctk.CTkButton(row, text="🔌 测试连接", width=110, command=self._test_conn).pack(side="left", padx=(0, 8))
        self._conn_status = ctk.CTkLabel(row, text="", font=("", 11))
        self._conn_status.pack(side="left")

        # Provider + Language row
        opts_frame = ctk.CTkFrame(self, fg_color="transparent")
        opts_frame.pack(fill="x", **pad)
        ctk.CTkLabel(opts_frame, text="默认 Provider", font=("", 11)).grid(row=0, column=0, sticky="w")
        self._provider_var = ctk.StringVar(value=self.app.cfg.get("provider", "claude"))
        ctk.CTkOptionMenu(opts_frame, variable=self._provider_var,
                          values=["claude", "openai", "gemini"], width=140).grid(row=1, column=0, padx=(0, 20))
        ctk.CTkLabel(opts_frame, text="默认语言", font=("", 11)).grid(row=0, column=1, sticky="w")
        self._lang_var = ctk.StringVar(value=self.app.cfg.get("language", "ja"))
        ctk.CTkOptionMenu(opts_frame, variable=self._lang_var,
                          values=["ja", "en", "zh"], width=140).grid(row=1, column=1)

        # Save button
        ctk.CTkButton(self, text="💾 保存设置", width=120, command=self._save).pack(anchor="e", padx=20, pady=12)

    def _test_conn(self):
        url = self._url_entry.get().strip()
        self._conn_status.configure(text="测试中…", text_color="gray")

        def _check():
            from api.cap_client import CapClient
            ok = CapClient(url).ping()
            self.after(0, lambda: self._conn_status.configure(
                text="✓ 已连接" if ok else "✗ 无法连接",
                text_color="#22c55e" if ok else "#ef4444",
            ))

        threading.Thread(target=_check, daemon=True).start()

    def _save(self):
        self.app.cfg["server_url"] = self._url_entry.get().strip()
        self.app.cfg["provider"] = self._provider_var.get()
        self.app.cfg["language"] = self._lang_var.get()
        config.save(self.app.cfg)
        self.app.update_status(False)
        self.app._refresh_status()
```

- [ ] **Step 2: Run smoke test and verify visually**

```bash
python gui_main.py
```

Navigate to ⚙ 设置. Verify: URL field shows `http://localhost:4004`, test connection button shows ✓/✗, save persists to `config.json`.

- [ ] **Step 3: Commit**

```bash
git add gui/frames/settings_frame.py
git commit -m "feat: implement settings_frame with CAP connection test"
```

---

## Task 8: match_frame

**Files:**
- Modify: `if_mapping_gui/gui/frames/match_frame.py` (replace stub)
- Create: `if_mapping_gui/tests/test_match_worker.py`

- [ ] **Step 1: Write tests for the worker function**

```python
# tests/test_match_worker.py
import queue
import threading
from pathlib import Path
from unittest.mock import patch, MagicMock
import openpyxl
import pytest

from gui.frames.match_frame import match_worker

def _make_xlsx(tmp_path, rows):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(["sourceField", "sourceDesc"])
    for r in rows:
        ws.append(r)
    p = tmp_path / "input.xlsx"
    wb.save(p)
    return p

def _drain(q):
    msgs = []
    while not q.empty():
        msgs.append(q.get_nowait())
    return msgs

def test_worker_emits_done_with_results(tmp_path):
    xlsx = _make_xlsx(tmp_path, [["MATNR", "Material"]])
    q = queue.Queue()
    stop = threading.Event()
    mock_results = [{"rowIndex": 2, "targetField": "Material", "matchType": "exact",
                     "targetEntity": "CDS_View", "confidence": 1.0, "aiReason": ""}]
    with patch("gui.frames.match_frame.CapClient") as MockClient:
        MockClient.return_value.ping.return_value = True
        MockClient.return_value.match.return_value = mock_results
        match_worker([str(xlsx)], "claude", "ja", "http://localhost:4004", q, stop)
    msgs = _drain(q)
    types = [m["type"] for m in msgs]
    assert "done" in types
    done_msg = next(m for m in msgs if m["type"] == "done")
    assert done_msg["results"] == mock_results

def test_worker_emits_error_when_cap_unreachable(tmp_path):
    xlsx = _make_xlsx(tmp_path, [["MATNR", "Material"]])
    q = queue.Queue()
    stop = threading.Event()
    with patch("gui.frames.match_frame.CapClient") as MockClient:
        MockClient.return_value.ping.return_value = False
        match_worker([str(xlsx)], "claude", "ja", "http://localhost:4004", q, stop)
    msgs = _drain(q)
    types = [m["type"] for m in msgs]
    assert "error" in types

def test_worker_skips_bad_excel_and_continues(tmp_path):
    bad = tmp_path / "bad.xlsx"
    wb = openpyxl.Workbook()
    wb.active.append(["wrong_col"])
    wb.save(bad)
    good = _make_xlsx(tmp_path, [["MATNR", "Material"]])
    q = queue.Queue()
    stop = threading.Event()
    with patch("gui.frames.match_frame.CapClient") as MockClient:
        MockClient.return_value.ping.return_value = True
        MockClient.return_value.match.return_value = []
        match_worker([str(bad), str(good)], "claude", "ja", "http://localhost:4004", q, stop)
    msgs = _drain(q)
    log_texts = [m["text"] for m in msgs if m["type"] == "log"]
    assert any("sourceField" in t or "ERROR" in t for t in log_texts)
    assert any(m["type"] == "done" for m in msgs)

def test_worker_respects_stop_event(tmp_path):
    files = [str(_make_xlsx(tmp_path / f"f{i}", [["MATNR", "Material"]])) for i in range(3)]
    for i in range(3):
        (tmp_path / f"f{i}").mkdir(exist_ok=True)
        wb = openpyxl.Workbook()
        wb.active.append(["sourceField", "sourceDesc"])
        wb.active.append(["MATNR", "Material"])
        wb.save(tmp_path / f"f{i}" / "input.xlsx")
    files = [str(tmp_path / f"f{i}" / "input.xlsx") for i in range(3)]
    q = queue.Queue()
    stop = threading.Event()
    stop.set()  # stopped before start
    with patch("gui.frames.match_frame.CapClient") as MockClient:
        MockClient.return_value.ping.return_value = True
        match_worker(files, "claude", "ja", "http://localhost:4004", q, stop)
    msgs = _drain(q)
    log_texts = [m["text"] for m in msgs if m["type"] == "log"]
    assert any("停止" in t for t in log_texts)
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/test_match_worker.py -v
```

Expected: `ImportError: cannot import name 'match_worker' from 'gui.frames.match_frame'`

- [ ] **Step 3: Implement `match_frame.py`**

```python
# gui/frames/match_frame.py
import queue
import threading
from pathlib import Path
from tkinter import filedialog
from datetime import datetime

import customtkinter as ctk

import config
from api.cap_client import CapClient
from excel.reader import read_fields, ExcelReadError
from excel.writer import write_results
from gui.frames import BaseFrame

LOG_COLORS = {"info": "#22c55e", "warn": "#f59e0b", "error": "#ef4444", "step": "#7b8cde"}


def match_worker(
    files: list[str],
    provider: str,
    language: str,
    server_url: str,
    q: queue.Queue,
    stop: threading.Event,
) -> None:
    """Background worker: runs matching pipeline and puts messages on q."""

    def log(text, level="info"):
        ts = datetime.now().strftime("%H:%M:%S")
        q.put({"type": "log", "text": f"[{ts}]  {level.upper():<5} {text}", "level": level})

    client = CapClient(server_url)
    if not client.ping():
        log(f"无法连接到 {server_url} — 请检查 CAP 是否已启动", "error")
        q.put({"type": "error", "msg": "CAP service unreachable"})
        return

    all_results: list[dict] = []
    all_raw: dict[str, list[dict]] = {}

    for i, file_str in enumerate(files):
        if stop.is_set():
            log("用户停止 — 处理中断", "warn")
            break

        path = Path(file_str)
        try:
            fields, raw_rows = read_fields(path)
            all_raw[file_str] = raw_rows
            log(f"解析 {path.name} — {len(fields)} 条字段")
        except ExcelReadError as e:
            log(str(e), "error")
            continue

        try:
            results = client.match(
                [f.to_dict() for f in fields],
                provider=provider,
                language=language,
            )
            all_results.extend(results)
            exact = sum(1 for r in results if r.get("matchType") == "exact")
            vector = sum(1 for r in results if r.get("matchType") == "vector")
            ai = sum(1 for r in results if r.get("matchType") == "ai")
            log(f"匹配完成: {len(results)} 条 (精确 {exact} · 向量 {vector} · AI {ai})", "step")
        except Exception as e:
            log(f"{path.name} 匹配失败: {e}", "error")

        q.put({"type": "progress", "pct": (i + 1) / len(files)})

    q.put({"type": "done", "results": all_results, "raw": all_raw, "files": files})


class MatchFrame(BaseFrame):
    def __init__(self, master, app, **kwargs):
        super().__init__(master, app, **kwargs)
        self._files: list[str] = []
        self._results: list[dict] = []
        self._raw: dict[str, list[dict]] = {}
        self._queue: queue.Queue = queue.Queue()
        self._stop_event = threading.Event()
        self._build()

    def _build(self):
        pad = {"padx": 16, "pady": 6}

        # Drop zone (click to select)
        self._drop_zone = ctk.CTkButton(
            self, text="📂  点击选择 Excel 文件（可多选）\n支持 .xlsx / .xls",
            height=72, fg_color="#1e293b", hover_color="#334155",
            text_color="#64748b", command=self._pick_files,
        )
        self._drop_zone.pack(fill="x", **pad)

        # File list
        self._file_list_frame = ctk.CTkScrollableFrame(self, height=80, fg_color="#1e293b")
        self._file_list_frame.pack(fill="x", padx=16, pady=(0, 6))

        # Options row
        opts = ctk.CTkFrame(self, fg_color="transparent")
        opts.pack(fill="x", padx=16, pady=(0, 6))
        ctk.CTkLabel(opts, text="Provider", font=("", 10), text_color="gray").grid(row=0, column=0, sticky="w")
        self._provider_var = ctk.StringVar(value=self.app.cfg.get("provider", "claude"))
        ctk.CTkOptionMenu(opts, variable=self._provider_var,
                          values=["claude", "openai", "gemini"], width=120).grid(row=1, column=0, padx=(0, 10))
        ctk.CTkLabel(opts, text="语言", font=("", 10), text_color="gray").grid(row=0, column=1, sticky="w")
        self._lang_var = ctk.StringVar(value=self.app.cfg.get("language", "ja"))
        ctk.CTkOptionMenu(opts, variable=self._lang_var,
                          values=["ja", "en", "zh"], width=100).grid(row=1, column=1, padx=(0, 10))
        self._start_btn = ctk.CTkButton(opts, text="▶ 开始匹配", width=100, command=self._start)
        self._start_btn.grid(row=1, column=2, padx=(10, 6))
        self._stop_btn = ctk.CTkButton(opts, text="■ 停止", width=80,
                                       fg_color="#1e293b", command=self._stop, state="disabled")
        self._stop_btn.grid(row=1, column=3)

        # Progress bar
        self._progress = ctk.CTkProgressBar(self)
        self._progress.set(0)
        self._progress.pack(fill="x", padx=16, pady=(0, 6))

        # Log area
        self._log = ctk.CTkTextbox(self, height=160, font=("Consolas", 10), state="disabled")
        self._log.pack(fill="both", expand=True, padx=16, pady=(0, 6))

        # Result + export bar
        result_bar = ctk.CTkFrame(self, fg_color="transparent")
        result_bar.pack(fill="x", padx=16, pady=(0, 10))
        self._result_label = ctk.CTkLabel(result_bar, text="", font=("", 11), text_color="gray")
        self._result_label.pack(side="left")
        self._export_btn = ctk.CTkButton(result_bar, text="📥 导出结果 Excel",
                                          width=140, command=self._export, state="disabled")
        self._export_btn.pack(side="right")

    def _pick_files(self):
        paths = filedialog.askopenfilenames(
            title="选择 Excel 文件",
            filetypes=[("Excel files", "*.xlsx *.xls")],
            initialdir=self.app.cfg.get("last_input_dir") or None,
        )
        for p in paths:
            if p not in self._files:
                self._files.append(p)
        if paths:
            self.app.cfg["last_input_dir"] = str(Path(paths[0]).parent)
            config.save(self.app.cfg)
        self._refresh_file_list()

    def _refresh_file_list(self):
        for w in self._file_list_frame.winfo_children():
            w.destroy()
        for path_str in self._files:
            row = ctk.CTkFrame(self._file_list_frame, fg_color="transparent")
            row.pack(fill="x", pady=1)
            ctk.CTkLabel(row, text=f"📄 {Path(path_str).name}", font=("", 11)).pack(side="left")
            ctk.CTkButton(row, text="✕", width=24, height=20,
                          command=lambda p=path_str: self._remove_file(p)).pack(side="right")

    def _remove_file(self, path_str: str):
        self._files.remove(path_str)
        self._refresh_file_list()

    def _log_append(self, text: str, level: str = "info"):
        color = LOG_COLORS.get(level, "white")
        self._log.configure(state="normal")
        self._log.insert("end", text + "\n")
        self._log.see("end")
        self._log.configure(state="disabled")

    def _start(self):
        if not self._files:
            self._log_append("[ERROR] 请先选择 Excel 文件", "error")
            return
        self._results.clear()
        self._raw.clear()
        self._stop_event.clear()
        self._start_btn.configure(state="disabled")
        self._stop_btn.configure(state="normal")
        self._export_btn.configure(state="disabled")
        self._progress.set(0)
        self._progress.configure(progress_color=("#7b8cde", "#7b8cde"))

        t = threading.Thread(
            target=match_worker,
            args=(list(self._files), self._provider_var.get(), self._lang_var.get(),
                  self.app.cfg.get("server_url", "http://localhost:4004"),
                  self._queue, self._stop_event),
            daemon=True,
        )
        t.start()
        self.after(100, self._poll)

    def _stop(self):
        self._stop_event.set()
        self._progress.configure(progress_color=("#f59e0b", "#f59e0b"))

    def _poll(self):
        try:
            while True:
                msg = self._queue.get_nowait()
                if msg["type"] == "log":
                    self._log_append(msg["text"], msg.get("level", "info"))
                elif msg["type"] == "progress":
                    self._progress.set(msg["pct"])
                elif msg["type"] == "done":
                    self._results = msg["results"]
                    self._raw = msg["raw"]
                    self._on_done()
                    return
                elif msg["type"] == "error":
                    self._on_error()
                    return
        except Exception:
            pass
        self.after(100, self._poll)

    def _on_done(self):
        exact = sum(1 for r in self._results if r.get("matchType") == "exact")
        vector = sum(1 for r in self._results if r.get("matchType") == "vector")
        ai = sum(1 for r in self._results if r.get("matchType") == "ai")
        self._result_label.configure(
            text=f"完成: {len(self._results)} 条 ｜ 精确 {exact} ｜ 向量 {vector} ｜ AI {ai}"
        )
        self._progress.set(1.0)
        self._start_btn.configure(state="normal")
        self._stop_btn.configure(state="disabled")
        if self._results:
            self._export_btn.configure(state="normal")

    def _on_error(self):
        self._start_btn.configure(state="normal")
        self._stop_btn.configure(state="disabled")

    def _export(self):
        for file_str in self._files:
            raw_rows = self._raw.get(file_str)
            if not raw_rows:
                continue
            file_results = [r for r in self._results if r.get("rowIndex") in {rr["rowIndex"] for rr in raw_rows}]
            out = write_results(Path(file_str), raw_rows, file_results)
            self._log_append(f"已导出: {out.name}", "info")
```

- [ ] **Step 4: Run worker tests**

```bash
pytest tests/test_match_worker.py -v
```

Expected: 4 tests PASS.

- [ ] **Step 5: Visual smoke test**

```bash
python gui_main.py
```

Navigate to ▶ 字段匹配. Verify: file picker opens on click, files appear in list with ✕, Start triggers progress bar and log output, Stop button works.

- [ ] **Step 6: Commit**

```bash
git add gui/frames/match_frame.py tests/test_match_worker.py
git commit -m "feat: implement match_frame with threading and export"
```

---

## Task 9: upload_frame

**Files:**
- Modify: `if_mapping_gui/gui/frames/upload_frame.py` (replace stub)

- [ ] **Step 1: Implement `upload_frame.py`**

```python
# gui/frames/upload_frame.py
import queue
import threading
from pathlib import Path
from tkinter import filedialog
from datetime import datetime

import customtkinter as ctk

import config
from api.cap_client import CapClient, CapConnectionError
from excel.reader import read_fields, ExcelReadError
from gui.frames import BaseFrame


def upload_worker(
    file_str: str,
    mode: str,
    server_url: str,
    q: queue.Queue,
    stop: threading.Event,
) -> None:
    def log(text, level="info"):
        ts = datetime.now().strftime("%H:%M:%S")
        q.put({"type": "log", "text": f"[{ts}]  {level.upper():<5} {text}", "level": level})

    client = CapClient(server_url)
    if not client.ping():
        log(f"无法连接到 {server_url}", "error")
        q.put({"type": "error"})
        return

    path = Path(file_str)
    try:
        fields, _ = read_fields(path)
        log(f"解析 {path.name} — {len(fields)} 条记录")
    except ExcelReadError as e:
        log(str(e), "error")
        q.put({"type": "error"})
        return

    try:
        records = [f.to_dict() for f in fields]
        result = client.upload_custom_fields(records, mode=mode)
        inserted = result.get("inserted", 0)
        updated = result.get("updated", 0)
        deleted = result.get("deleted", 0)
        log(f"上传完成: 插入 {inserted}, 更新 {updated}, 删除 {deleted}")
        q.put({"type": "done"})
    except CapConnectionError as e:
        log(f"上传失败: {e}", "error")
        q.put({"type": "error"})


class UploadFrame(BaseFrame):
    def __init__(self, master, app, **kwargs):
        super().__init__(master, app, **kwargs)
        self._file: str = ""
        self._queue: queue.Queue = queue.Queue()
        self._stop_event = threading.Event()
        self._build()

    def _build(self):
        pad = {"padx": 16, "pady": 8}

        ctk.CTkLabel(self, text="上传知识库", font=("", 16, "bold")).pack(anchor="w", padx=20, pady=(20, 4))

        # Drop zone
        self._drop_btn = ctk.CTkButton(
            self, text="📂  点击选择知识库 Excel 文件", height=60,
            fg_color="#1e293b", hover_color="#334155", text_color="#64748b",
            command=self._pick_file,
        )
        self._drop_btn.pack(fill="x", **pad)

        self._file_label = ctk.CTkLabel(self, text="", font=("", 11), text_color="#94a3b8")
        self._file_label.pack(anchor="w", padx=16)

        # Mode + upload row
        opts = ctk.CTkFrame(self, fg_color="transparent")
        opts.pack(fill="x", **pad)
        ctk.CTkLabel(opts, text="上传模式", font=("", 10), text_color="gray").pack(side="left", padx=(0, 6))
        self._mode_var = ctk.StringVar(value="upsert")
        ctk.CTkOptionMenu(opts, variable=self._mode_var,
                          values=["upsert", "overwrite"], width=160).pack(side="left", padx=(0, 12))
        self._upload_btn = ctk.CTkButton(opts, text="⬆ 上传", width=90, command=self._start)
        self._upload_btn.pack(side="left")

        # Log
        self._log = ctk.CTkTextbox(self, height=160, font=("Consolas", 10), state="disabled")
        self._log.pack(fill="both", expand=True, padx=16, pady=(6, 16))

    def _pick_file(self):
        path = filedialog.askopenfilename(
            title="选择知识库 Excel",
            filetypes=[("Excel files", "*.xlsx *.xls")],
            initialdir=self.app.cfg.get("last_input_dir") or None,
        )
        if path:
            self._file = path
            self._file_label.configure(text=f"📄 {Path(path).name}")

    def _log_append(self, text: str):
        self._log.configure(state="normal")
        self._log.insert("end", text + "\n")
        self._log.see("end")
        self._log.configure(state="disabled")

    def _start(self):
        if not self._file:
            self._log_append("[ERROR] 请先选择文件")
            return
        self._upload_btn.configure(state="disabled")
        self._stop_event.clear()
        threading.Thread(
            target=upload_worker,
            args=(self._file, self._mode_var.get(),
                  self.app.cfg.get("server_url", "http://localhost:4004"),
                  self._queue, self._stop_event),
            daemon=True,
        ).start()
        self.after(100, self._poll)

    def _poll(self):
        try:
            while True:
                msg = self._queue.get_nowait()
                if msg["type"] == "log":
                    self._log_append(msg["text"])
                elif msg["type"] in ("done", "error"):
                    self._upload_btn.configure(state="normal")
                    return
        except Exception:
            pass
        self.after(100, self._poll)
```

- [ ] **Step 2: Visual smoke test**

```bash
python gui_main.py
```

Navigate to ⬆ 上传知识库. Verify: file picker opens, mode dropdown shows upsert/overwrite, upload button triggers log output.

- [ ] **Step 3: Commit**

```bash
git add gui/frames/upload_frame.py
git commit -m "feat: implement upload_frame with worker thread"
```

---

## Task 10: prompts_frame

**Files:**
- Modify: `if_mapping_gui/gui/frames/prompts_frame.py` (replace stub)

- [ ] **Step 1: Implement `prompts_frame.py`**

```python
# gui/frames/prompts_frame.py
import threading
import customtkinter as ctk
from gui.frames import BaseFrame


class PromptsFrame(BaseFrame):
    def __init__(self, master, app, **kwargs):
        super().__init__(master, app, **kwargs)
        self._prompts: list[dict] = []
        self._selected_idx: int | None = None
        self._lang_filter = "ja"
        self._build()

    def _build(self):
        ctk.CTkLabel(self, text="Prompt 管理", font=("", 16, "bold")).pack(anchor="w", padx=20, pady=(20, 8))

        main = ctk.CTkFrame(self, fg_color="transparent")
        main.pack(fill="both", expand=True, padx=16, pady=(0, 16))
        main.columnconfigure(1, weight=1)
        main.rowconfigure(1, weight=1)

        # Language filter chips
        filter_row = ctk.CTkFrame(main, fg_color="transparent")
        filter_row.grid(row=0, column=0, sticky="ew", pady=(0, 6))
        self._lang_btns: dict[str, ctk.CTkButton] = {}
        for lang in ("ja", "en", "zh"):
            btn = ctk.CTkButton(filter_row, text=lang.upper(), width=44, height=26,
                                command=lambda l=lang: self._set_lang(l))
            btn.pack(side="left", padx=2)
            self._lang_btns[lang] = btn
        self._set_lang("ja")

        # Prompt list (left)
        self._list_frame = ctk.CTkScrollableFrame(main, width=210)
        self._list_frame.grid(row=1, column=0, sticky="ns", padx=(0, 10))

        # Edit panel (right)
        right = ctk.CTkFrame(main, fg_color="transparent")
        right.grid(row=0, column=1, rowspan=2, sticky="nsew")
        right.rowconfigure(1, weight=1)

        self._edit_title = ctk.CTkLabel(right, text="", font=("", 12, "bold"))
        self._edit_title.grid(row=0, column=0, sticky="w", pady=(0, 6))
        self._editor = ctk.CTkTextbox(right, font=("Consolas", 11))
        self._editor.grid(row=1, column=0, sticky="nsew")
        right.columnconfigure(0, weight=1)

        btn_row = ctk.CTkFrame(right, fg_color="transparent")
        btn_row.grid(row=2, column=0, sticky="e", pady=(8, 0))
        ctk.CTkButton(btn_row, text="取消", width=70, fg_color="#1e293b",
                      command=self._cancel).pack(side="left", padx=4)
        ctk.CTkButton(btn_row, text="💾 保存", width=80, command=self._save).pack(side="left", padx=4)
        ctk.CTkButton(btn_row, text="🔄 重载", width=80, fg_color="#1e293b",
                      command=self._reload_server).pack(side="left", padx=4)

        # Load prompts on display
        self.bind("<Visibility>", lambda e: self._load_prompts())
        self._load_prompts()

    def _set_lang(self, lang: str):
        self._lang_filter = lang
        for l, btn in self._lang_btns.items():
            btn.configure(fg_color="#0f3460" if l == lang else "#1e293b")
        self._load_prompts()

    def _load_prompts(self):
        def _fetch():
            try:
                prompts = self.app.get_client().get_prompts(language=self._lang_filter)
                self.after(0, lambda: self._populate_list(prompts))
            except Exception:
                pass
        threading.Thread(target=_fetch, daemon=True).start()

    def _populate_list(self, prompts: list[dict]):
        self._prompts = prompts
        for w in self._list_frame.winfo_children():
            w.destroy()
        for i, p in enumerate(prompts):
            label = f"{p.get('step', '')} / {p.get('promptType', '')}"
            btn = ctk.CTkButton(self._list_frame, text=label, anchor="w", height=30,
                                font=("", 11), command=lambda idx=i: self._select(idx))
            btn.pack(fill="x", pady=1)
        if prompts and self._selected_idx is None:
            self._select(0)

    def _select(self, idx: int):
        self._selected_idx = idx
        p = self._prompts[idx]
        self._edit_title.configure(
            text=f"{p.get('step')} / {p.get('promptType')} / {p.get('language', '').upper()}"
        )
        self._editor.delete("1.0", "end")
        self._editor.insert("1.0", p.get("content", ""))

    def _cancel(self):
        if self._selected_idx is not None:
            self._select(self._selected_idx)

    def _save(self):
        if self._selected_idx is None:
            return
        p = self._prompts[self._selected_idx]
        content = self._editor.get("1.0", "end-1c")
        def _patch():
            try:
                self.app.get_client().patch_prompt(p["ID"], content)
                self._prompts[self._selected_idx]["content"] = content
            except Exception as e:
                print(f"patch_prompt error: {e}")
        threading.Thread(target=_patch, daemon=True).start()

    def _reload_server(self):
        def _reload():
            try:
                self.app.get_client().reload_prompts()
            except Exception as e:
                print(f"reload_prompts error: {e}")
        threading.Thread(target=_reload, daemon=True).start()
```

- [ ] **Step 2: Visual smoke test**

```bash
python gui_main.py
```

Navigate to 📝 Prompt 管理. Verify: language chips switch list content, clicking a prompt populates the editor, Save/Reload buttons respond (check CAP logs when service is running).

- [ ] **Step 3: Commit**

```bash
git add gui/frames/prompts_frame.py
git commit -m "feat: implement prompts_frame with edit and reload"
```

---

## Task 11: logs_frame

**Files:**
- Modify: `if_mapping_gui/gui/frames/logs_frame.py` (replace stub)

- [ ] **Step 1: Implement `logs_frame.py`**

```python
# gui/frames/logs_frame.py
import threading
import customtkinter as ctk
from gui.frames import BaseFrame


class LogsFrame(BaseFrame):
    def __init__(self, master, app, **kwargs):
        super().__init__(master, app, **kwargs)
        self._build()

    def _build(self):
        header = ctk.CTkFrame(self, fg_color="transparent")
        header.pack(fill="x", padx=16, pady=(16, 8))
        ctk.CTkLabel(header, text="Token 日志", font=("", 16, "bold")).pack(side="left")
        ctk.CTkButton(header, text="🔄 刷新", width=80, command=self._load).pack(side="right")

        # Summary chips
        chips = ctk.CTkFrame(self, fg_color="transparent")
        chips.pack(fill="x", padx=16, pady=(0, 12))
        self._input_label = self._chip(chips, "0", "总 Input Tokens")
        self._input_label.pack(side="left", padx=(0, 10))
        self._output_label = self._chip(chips, "0", "总 Output Tokens")
        self._output_label.pack(side="left", padx=(0, 10))
        self._calls_label = self._chip(chips, "0", "调用次数")
        self._calls_label.pack(side="left")

        # Table header
        header_row = ctk.CTkFrame(self, fg_color="#1e293b", height=28)
        header_row.pack(fill="x", padx=16)
        for col, w in [("时间", 80), ("Provider", 70), ("Step", 120), ("Input", 70), ("Output", 70)]:
            ctk.CTkLabel(header_row, text=col, font=("", 10, "bold"), width=w).pack(side="left", padx=4)

        # Scrollable table body
        self._table = ctk.CTkScrollableFrame(self, fg_color="transparent")
        self._table.pack(fill="both", expand=True, padx=16, pady=(0, 16))

        self._load()

    def _chip(self, parent, value: str, label: str) -> ctk.CTkFrame:
        frame = ctk.CTkFrame(parent, fg_color="#1e293b", corner_radius=6)
        val_lbl = ctk.CTkLabel(frame, text=value, font=("", 18, "bold"), text_color="#7b8cde")
        val_lbl.pack(padx=14, pady=(8, 0))
        ctk.CTkLabel(frame, text=label, font=("", 10), text_color="gray").pack(padx=14, pady=(0, 8))
        frame._value_label = val_lbl
        return frame

    def _load(self):
        def _fetch():
            try:
                logs = self.app.get_client().get_token_logs()
                self.after(0, lambda: self._populate(logs))
            except Exception:
                pass
        threading.Thread(target=_fetch, daemon=True).start()

    def _populate(self, logs: list[dict]):
        for w in self._table.winfo_children():
            w.destroy()

        total_in = sum(r.get("inputTokens", 0) for r in logs)
        total_out = sum(r.get("outputTokens", 0) for r in logs)
        self._input_label._value_label.configure(text=f"{total_in:,}")
        self._output_label._value_label.configure(text=f"{total_out:,}")
        self._calls_label._value_label.configure(text=str(len(logs)))

        for entry in logs:
            row = ctk.CTkFrame(self._table, fg_color="transparent")
            row.pack(fill="x", pady=1)
            ts = str(entry.get("createdAt", ""))[:19].replace("T", " ")
            for val, w in [
                (ts, 80),
                (entry.get("provider", ""), 70),
                (entry.get("step", ""), 120),
                (str(entry.get("inputTokens", "")), 70),
                (str(entry.get("outputTokens", "")), 70),
            ]:
                ctk.CTkLabel(row, text=val, font=("Consolas", 10), width=w,
                             text_color="#94a3b8").pack(side="left", padx=4)
```

- [ ] **Step 2: Visual smoke test**

```bash
python gui_main.py
```

Navigate to 📊 Token 日志. Verify: Refresh button triggers fetch, summary chips update, table rows appear when CAP is running.

- [ ] **Step 3: Commit**

```bash
git add gui/frames/logs_frame.py
git commit -m "feat: implement logs_frame with token summary and table"
```

---

## Task 12: Entry Point + Final Integration

**Files:**
- Create: `if_mapping_gui/gui_main.py`

- [ ] **Step 1: Implement `gui_main.py`**

```python
# gui_main.py
from gui.app import App

if __name__ == "__main__":
    app = App()
    app.mainloop()
```

- [ ] **Step 2: Run all unit tests**

```bash
cd d:/Users/PC/Projects/if_mapping_gui
pytest -v
```

Expected: all tests PASS (unit tests + GUI smoke tests on Windows).

- [ ] **Step 3: Full end-to-end smoke test**

With `if_mapping_cap` running (`cds serve` in `d:/Users/PC/Projects/if_mapping_cap`):

```bash
python gui_main.py
```

Verify the following golden path:
1. Status bar shows green ● http://localhost:4004
2. ⚙ 设置 → Test Connection shows ✓ 已连接
3. ▶ 字段匹配 → select a real IF Excel file → Start → log shows match steps → Export creates `*_matched_*.xlsx`
4. ⬆ 上传知识库 → select a knowledge base Excel → Upload → log shows counts
5. 📝 Prompt 管理 → prompts load, edit one, Save, then Reload
6. 📊 Token 日志 → Refresh shows logged entries

- [ ] **Step 4: Commit**

```bash
git add gui_main.py
git commit -m "feat: add entry point and complete if_mapping_gui v0.1.0"
```

---

## Running Tests

```bash
cd d:/Users/PC/Projects/if_mapping_gui

# All unit tests (no display needed)
pytest tests/test_config.py tests/test_cap_client.py tests/test_excel_reader.py tests/test_excel_writer.py tests/test_match_worker.py -v

# All tests including GUI smoke (Windows only)
pytest -v
```

Expected final output: all tests PASS.
