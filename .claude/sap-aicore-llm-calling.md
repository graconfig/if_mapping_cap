# SAP AI Core LLM Calling Skill

This skill describes how to call LLM models deployed on SAP AI Core. SAP AI Core exposes different API endpoints depending on the model provider:

- **Claude (Anthropic)**: uses the **Converse API** (`/converse`)
- **GPT (OpenAI)** and other models: uses the **Chat Completion API** (`/chat/completions`)

## Prerequisites

- SAP AI Core instance with a deployed LLM model
- OAuth2 client credentials (client_id, client_secret)
- Python packages: `requests`, `python-dotenv`

## Environment Variables

Set the following in a `.env` file or system environment:

```
AICORE_AUTH_URL=https://<subdomain>.authentication.<region>.hana.ondemand.com
AICORE_CLIENT_ID=<your-client-id>
AICORE_CLIENT_SECRET=<your-client-secret>
AICORE_BASE_URL=https://api.ai.prod.<region>.aws.ml.hana.ondemand.com/v2
AICORE_RESOURCE_GROUP=default
AICORE_DEPLOYMENT_ID=<your-deployment-id>
# モデル名を指定すると、DEPLOYMENT_IDをAI Coreから動的に取得（DEPLOYMENT_IDより優先）
# AICORE_MODEL_NAME=claude-3.5-sonnet
```

`AICORE_MODEL_NAME` と `AICORE_DEPLOYMENT_ID` の優先順位：
1. `AICORE_MODEL_NAME` が設定されている場合 → Deployment一覧APIからモデル名で動的にdeployment_idを取得
2. 動的取得に失敗した場合 → `AICORE_DEPLOYMENT_ID` にフォールバック
3. `AICORE_MODEL_NAME` が未設定の場合 → `AICORE_DEPLOYMENT_ID` を直接使用

## Step 1: Obtain OAuth2 Access Token (Common)

Both APIs share the same OAuth2 authentication flow.

```python
import os
import requests
from dotenv import load_dotenv

load_dotenv()

def get_access_token() -> str:
    auth_url = os.getenv("AICORE_AUTH_URL")
    client_id = os.getenv("AICORE_CLIENT_ID")
    client_secret = os.getenv("AICORE_CLIENT_SECRET")

    response = requests.post(
        f"{auth_url}/oauth/token",
        auth=(client_id, client_secret),
        data={"grant_type": "client_credentials"},
    )
    response.raise_for_status()
    return response.json()["access_token"]
```

## Step 1.5: Resolve Deployment ID by Model Name (Optional)

When `AICORE_MODEL_NAME` is set, dynamically resolve the deployment ID from the AI Core Deployment API instead of using a hardcoded `AICORE_DEPLOYMENT_ID`.

### Endpoint

```
GET {base_url}/lm/deployments?status=RUNNING
```

### Headers

| Header | Value |
|---|---|
| `Authorization` | `Bearer {access_token}` |
| `AI-Resource-Group` | Resource group name (e.g. `default`) |

### Implementation

```python
def resolve_deployment_id(model_name: str) -> str:
    """Resolve deployment ID by model name from AI Core Deployment API.

    Queries running deployments and matches by model name (partial match).
    Falls back to AICORE_DEPLOYMENT_ID env var on failure.

    Args:
        model_name: Model name to search for (e.g. "claude-3.5-sonnet")

    Returns:
        Deployment ID string
    """
    token = get_access_token()
    base_url = os.getenv("AICORE_BASE_URL")
    resource_group = os.getenv("AICORE_RESOURCE_GROUP", "default")

    url = f"{base_url}/lm/deployments"
    headers = {
        "Authorization": f"Bearer {token}",
        "AI-Resource-Group": resource_group,
        "Content-Type": "application/json",
    }
    params = {"status": "RUNNING"}

    response = requests.get(url, headers=headers, params=params)

    if response.status_code != 200:
        # Fallback to env var
        return os.getenv("AICORE_DEPLOYMENT_ID")

    deployments = response.json().get("resources", [])

    for deployment in deployments:
        details = deployment.get("details", {})
        resources = details.get("resources", {})

        # Check backendDetails.model.name / version
        backend_details = resources.get("backendDetails", {})
        deployed_model = backend_details.get("model", {})
        deployed_model_name = deployed_model.get("name", "")
        deployed_model_version = deployed_model.get("version", "")

        if (model_name.lower() in deployed_model_name.lower()
                or model_name.lower() in deployed_model_version.lower()):
            return deployment.get("id")

        # Also check configurationName
        config_name = deployment.get("configurationName", "")
        if model_name.lower() in config_name.lower():
            return deployment.get("id")

    # No match found, fallback
    return os.getenv("AICORE_DEPLOYMENT_ID")
```

### Deployment API Response Structure

```json
{
  "resources": [
    {
      "id": "d9eb209d94991674",
      "configurationName": "claude-3-5-sonnet-config",
      "status": "RUNNING",
      "details": {
        "resources": {
          "backendDetails": {
            "model": {
              "name": "anthropic--claude-3.5-sonnet",
              "version": "latest"
            }
          }
        }
      }
    }
  ]
}
```

### Matching Logic

The model name is matched using case-insensitive partial match against three fields:
- `details.resources.backendDetails.model.name`
- `details.resources.backendDetails.model.version`
- `configurationName`

---

## Claude Models — Converse API

The Converse API is specific to Anthropic Claude models on SAP AI Core.

### Endpoint

```
POST {base_url}/inference/deployments/{deployment_id}/converse
```

### Define Tools (Structured Output)

Tools follow the Converse API `toolSpec` format.

```python
tools = [
    {
        "toolSpec": {
            "name": "extract_info",
            "description": "Extract structured information",
            "inputSchema": {
                "json": {
                    "type": "object",
                    "properties": {
                        "title": {"type": "string"},
                        "tags": {
                            "type": "array",
                            "items": {"type": "string"},
                        },
                    },
                    "required": ["title", "tags"],
                }
            },
        }
    }
]
```

### Call Converse API

```python
def call_converse(
    prompt: str,
    tools: list[dict],
    max_tokens: int = 4096,
    temperature: float = 0.7,
) -> dict:
    """Call Claude via SAP AI Core Converse API with tool use.

    Returns:
        Dict mapping tool_name -> tool_input for each tool call.
    """
    token = get_access_token()
    base_url = os.getenv("AICORE_BASE_URL")
    deployment_id = os.getenv("AICORE_DEPLOYMENT_ID")
    resource_group = os.getenv("AICORE_RESOURCE_GROUP", "default")

    url = f"{base_url}/inference/deployments/{deployment_id}/converse"

    headers = {
        "Authorization": f"Bearer {token}",
        "AI-Resource-Group": resource_group,
        "Content-Type": "application/json",
    }

    payload = {
        "messages": [
            {
                "role": "user",
                "content": [{"type": "text", "text": prompt}],
            }
        ],
        "toolConfig": {
            "tools": tools,
            "toolChoice": {"any": {}},
        },
        "inferenceConfig": {
            "maxTokens": max_tokens,
            "temperature": temperature,
        },
    }

    response = requests.post(url, headers=headers, json=payload)
    response.raise_for_status()

    # Extract tool call results
    result = response.json()
    tool_calls = {}
    contents = (
        result.get("output", {})
        .get("message", {})
        .get("content", [])
    )
    for block in contents:
        if "toolUse" in block:
            tool_use = block["toolUse"]
            tool_calls[tool_use["name"]] = tool_use.get("input", {})

    return tool_calls
```

### Converse toolChoice Options

| Value | Behavior |
|---|---|
| `{"any": {}}` | Model must call at least one tool |
| `{"auto": {}}` | Model decides whether to call a tool |
| `{"tool": {"name": "tool_name"}}` | Model must call the specified tool |

### Converse Response Structure

```
response.output.message.content[] -> each block may contain:
  - {"text": "..."} for text output
  - {"toolUse": {"name": "...", "input": {...}}} for tool calls
```

---

## GPT / Other Models — Chat Completion API

For OpenAI GPT models and other non-Claude models on SAP AI Core.

### Endpoint

```
POST {base_url}/inference/deployments/{deployment_id}/chat/completions
```

### Define Tools (Structured Output)

Tools follow the OpenAI function calling format.

```python
tools = [
    {
        "type": "function",
        "function": {
            "name": "extract_info",
            "description": "Extract structured information",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "tags": {
                        "type": "array",
                        "items": {"type": "string"},
                    },
                },
                "required": ["title", "tags"],
            },
        },
    }
]
```

### Call Chat Completion API

```python
import json

def call_chat_completion(
    prompt: str,
    tools: list[dict],
    max_tokens: int = 4096,
    temperature: float = 0.7,
) -> dict:
    """Call GPT via SAP AI Core Chat Completion API with function calling.

    Returns:
        Dict mapping function_name -> parsed arguments for each tool call.
    """
    token = get_access_token()
    base_url = os.getenv("AICORE_BASE_URL")
    deployment_id = os.getenv("AICORE_DEPLOYMENT_ID")
    resource_group = os.getenv("AICORE_RESOURCE_GROUP", "default")

    url = f"{base_url}/inference/deployments/{deployment_id}/chat/completions"

    headers = {
        "Authorization": f"Bearer {token}",
        "AI-Resource-Group": resource_group,
        "Content-Type": "application/json",
    }

    payload = {
        "messages": [
            {"role": "user", "content": prompt}
        ],
        "tools": tools,
        "tool_choice": "auto",
        "max_tokens": max_tokens,
        "temperature": temperature,
    }

    response = requests.post(url, headers=headers, json=payload)
    response.raise_for_status()

    result = response.json()
    tool_calls = {}
    for choice in result.get("choices", []):
        message = choice.get("message", {})
        for tc in message.get("tool_calls", []):
            func = tc.get("function", {})
            name = func.get("name")
            args = json.loads(func.get("arguments", "{}"))
            tool_calls[name] = args

    return tool_calls
```

### Chat Completion tool_choice Options

| Value | Behavior |
|---|---|
| `"auto"` | Model decides whether to call a tool |
| `"required"` | Model must call at least one tool |
| `{"type": "function", "function": {"name": "..."}}` | Model must call the specified function |
| `"none"` | Model will not call any tool |

### Chat Completion Response Structure

```
response.choices[].message.tool_calls[] -> each item contains:
  - function.name: tool name
  - function.arguments: JSON string of arguments (needs json.loads)
```

---

## API Comparison Summary

| | Claude (Converse) | GPT (Chat Completion) |
|---|---|---|
| Endpoint | `/converse` | `/chat/completions` |
| Tool format | `toolSpec` with `inputSchema.json` | `function` with `parameters` |
| Force tool use | `toolChoice: {"any": {}}` | `tool_choice: "required"` |
| Message format | `content: [{type, text}]` | `content: "string"` |
| Response path | `output.message.content[].toolUse` | `choices[].message.tool_calls[]` |
| Arguments | Already parsed dict | JSON string (needs `json.loads`) |

## Error Handling

Common failure modes for both APIs:

- 401: Token expired or invalid credentials
- 404: Wrong deployment_id or base_url
- 400: Malformed tool schema or payload

```python
try:
    result = call_converse(prompt, tools)  # or call_chat_completion
except requests.exceptions.HTTPError as e:
    print(f"API error: {e.response.status_code} - {e.response.text}")
except Exception as e:
    print(f"Unexpected error: {e}")
```
