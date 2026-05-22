export interface Message {
  role:    'user' | 'assistant';
  content: string;
}

export interface ToolSchema {
  name:        string;
  description: string;
  inputSchema: {
    type:       string;
    properties: Record<string, unknown>;
    required:   string[];
  };
}

export interface ToolResult {
  toolName:  string;
  toolInput: unknown;
  usage: {
    inputTokens:  number;
    outputTokens: number;
  };
}

interface TokenCache {
  accessToken: string;
  expiresAt:   number;
}

export class AiCoreClient {
  private tokenCache:      TokenCache | null = null;
  private deploymentCache: Map<string, string> = new Map();

  private get authUrl():       string { return process.env.AICORE_AUTH_URL       ?? ''; }
  private get clientId():      string { return process.env.AICORE_CLIENT_ID      ?? ''; }
  private get clientSecret():  string { return process.env.AICORE_CLIENT_SECRET  ?? ''; }
  private get baseUrl():       string { return process.env.AICORE_BASE_URL        ?? ''; }
  private get resourceGroup(): string { return process.env.AICORE_RESOURCE_GROUP ?? 'default'; }

  private async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.tokenCache && this.tokenCache.expiresAt > now + 60_000) {
      return this.tokenCache.accessToken;
    }
    const creds = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    const tokenUrl = this.authUrl.endsWith('/oauth/token')
      ? this.authUrl
      : `${this.authUrl.replace(/\/$/, '')}/oauth/token`;
    const res = await fetch(tokenUrl, {
      method:  'POST',
      headers: {
        'Authorization': `Basic ${creds}`,
        'Content-Type':  'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    const rawText = await res.text();
    if (!res.ok) throw new Error(`AI Core auth failed: ${res.status} ${rawText}`);
    let json: { access_token: string; expires_in: number };
    try {
      json = JSON.parse(rawText) as { access_token: string; expires_in: number };
    } catch {
      throw new Error(`AI Core auth response is not valid JSON: ${rawText}`);
    }
    this.tokenCache = {
      accessToken: json.access_token,
      expiresAt:   now + json.expires_in * 1000,
    };
    return this.tokenCache.accessToken;
  }

  private async resolveDeploymentId(token: string, modelName: string): Promise<string> {
    if (this.deploymentCache.has(modelName)) {
      return this.deploymentCache.get(modelName)!;
    }
    const url = `${this.baseUrl}/lm/deployments?status=RUNNING`;
    const res = await fetch(url, { headers: this.commonHeaders(token) });
    if (!res.ok) {
      this.deploymentCache.set(modelName, modelName);
      return modelName;
    }

    const json = await res.json() as {
      resources: Array<{
        id: string;
        configurationName?: string;
        details?: {
          resources?: {
            backendDetails?: { model?: { name?: string; version?: string } };
          };
        };
      }>;
    };

    const lc = modelName.toLowerCase();
    for (const dep of json.resources ?? []) {
      const modelField  = dep.details?.resources?.backendDetails?.model?.name    ?? '';
      const versionField = dep.details?.resources?.backendDetails?.model?.version ?? '';
      const configName  = dep.configurationName ?? '';
      if (
        modelField.toLowerCase().includes(lc) ||
        versionField.toLowerCase().includes(lc) ||
        configName.toLowerCase().includes(lc)
      ) {
        this.deploymentCache.set(modelName, dep.id);
        return dep.id;
      }
    }
    this.deploymentCache.set(modelName, modelName);
    return modelName;
  }

  private commonHeaders(token: string): Record<string, string> {
    return {
      'Authorization':     `Bearer ${token}`,
      'Content-Type':      'application/json',
      'AI-Resource-Group': this.resourceGroup,
    };
  }

  // Claude models use the Converse API
  private async callConverse(
    token:      string,
    deployment: string,
    messages:   Message[],
    tools:      ToolSchema[]
  ): Promise<ToolResult> {
    const url  = `${this.baseUrl}/inference/deployments/${deployment}/converse`;
    const body = {
      messages: messages.map(m => ({
        role:    m.role,
        content: [{ type: 'text', text: m.content }],
      })),
      toolConfig: {
        tools: tools.map(t => ({
          toolSpec: {
            name:        t.name,
            description: t.description,
            inputSchema: { json: t.inputSchema },
          },
        })),
        toolChoice: { any: {} },
      },
    };

    const res = await fetch(url, {
      method:  'POST',
      headers: this.commonHeaders(token),
      body:    JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`AI Core Converse call failed: ${res.status} ${text}`);
    }

    const json = await res.json() as {
      output: {
        message: {
          content: Array<{ toolUse?: { name: string; input: unknown } }>;
        };
      };
      usage: { inputTokens: number; outputTokens: number };
    };

    const toolUse = json.output?.message?.content?.find(c => c.toolUse != null)?.toolUse;
    if (!toolUse) throw new Error('AI Core Converse response contained no toolUse block');

    return {
      toolName:  toolUse.name,
      toolInput: toolUse.input,
      usage: {
        inputTokens:  json.usage?.inputTokens  ?? 0,
        outputTokens: json.usage?.outputTokens ?? 0,
      },
    };
  }

  // GPT / other models use the Chat Completion API
  private async callChatCompletion(
    token:      string,
    deployment: string,
    messages:   Message[],
    tools:      ToolSchema[]
  ): Promise<ToolResult> {
    const url  = `${this.baseUrl}/inference/deployments/${deployment}/chat/completions`;
    const body = {
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      tools: tools.map(t => ({
        type:     'function',
        function: {
          name:        t.name,
          description: t.description,
          parameters:  t.inputSchema,
        },
      })),
      tool_choice: 'required',
      max_tokens:  4096,
    };

    const res = await fetch(url, {
      method:  'POST',
      headers: this.commonHeaders(token),
      body:    JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`AI Core Chat Completion call failed: ${res.status} ${text}`);
    }

    const json = await res.json() as {
      choices: Array<{
        message: {
          tool_calls?: Array<{ function: { name: string; arguments: string } }>;
        };
      }>;
      usage: { prompt_tokens: number; completion_tokens: number };
    };

    const toolCall = json.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) throw new Error('AI Core Chat Completion response contained no tool_calls');

    return {
      toolName:  toolCall.function.name,
      toolInput: JSON.parse(toolCall.function.arguments) as unknown,
      usage: {
        inputTokens:  json.usage?.prompt_tokens    ?? 0,
        outputTokens: json.usage?.completion_tokens ?? 0,
      },
    };
  }

  async callWithTools(
    messages:  Message[],
    tools:     ToolSchema[],
    provider:  string,
    model:     string
  ): Promise<ToolResult> {
    const token      = await this.getAccessToken();
    const deployment = await this.resolveDeploymentId(token, model);
    if (provider === 'claude') {
      return this.callConverse(token, deployment, messages, tools);
    }
    return this.callChatCompletion(token, deployment, messages, tools);
  }

  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    const token      = await this.getAccessToken();
    const model      = process.env.TEXT_EMBEDDING_MODEL ?? 'text-embedding-ada-002';
    const deployment = await this.resolveDeploymentId(token, model);
    const url        = `${this.baseUrl}/inference/deployments/${deployment}/embeddings`;

    const res = await fetch(url, {
      method:  'POST',
      headers: this.commonHeaders(token),
      body:    JSON.stringify({ input: texts }),
    });
    if (!res.ok) throw new Error(`AI Core embeddings failed: ${res.status}`);

    const json = await res.json() as { data: Array<{ embedding: number[] }> };
    return json.data.map(d => d.embedding);
  }
}
