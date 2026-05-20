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

const PROVIDER_PATH: Record<string, string> = {
  claude: 'anthropic',
  openai: 'openai',
  gemini: 'google',
};

export class AiCoreClient {
  private tokenCache: TokenCache | null = null;

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
    const res = await fetch(this.authUrl, {
      method:  'POST',
      headers: {
        'Authorization': `Basic ${creds}`,
        'Content-Type':  'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    if (!res.ok) throw new Error(`AI Core auth failed: ${res.status}`);
    const json = await res.json() as { access_token: string; expires_in: number };
    this.tokenCache = {
      accessToken: json.access_token,
      expiresAt:   now + json.expires_in * 1000,
    };
    return this.tokenCache.accessToken;
  }

  async callWithTools(
    messages: Message[],
    tools:    ToolSchema[],
    provider: string,
    model:    string
  ): Promise<ToolResult> {
    const token   = await this.getAccessToken();
    void PROVIDER_PATH[provider]; // referenced for future routing; currently all go to same endpoint
    const url = `${this.baseUrl}/v2/inference/deployments/${model}/invoke`;

    const body = {
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: 64000,
      messages,
      tools: tools.map(t => ({
        name:         t.name,
        description:  t.description,
        input_schema: t.inputSchema,
      })),
      tool_choice: { type: 'any' },
    };

    const res = await fetch(url, {
      method:  'POST',
      headers: {
        'Authorization':     `Bearer ${token}`,
        'Content-Type':      'application/json',
        'AI-Resource-Group': this.resourceGroup,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`AI Core LLM call failed: ${res.status} ${text}`);
    }

    const json = await res.json() as {
      content: Array<{ type: string; name?: string; input?: unknown }>;
      usage:   { input_tokens: number; output_tokens: number };
    };
    const toolUse = json.content.find(c => c.type === 'tool_use');
    if (!toolUse) throw new Error('AI Core response contained no tool_use block');

    return {
      toolName:  toolUse.name!,
      toolInput: toolUse.input,
      usage: {
        inputTokens:  json.usage.input_tokens,
        outputTokens: json.usage.output_tokens,
      },
    };
  }

  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    const token = await this.getAccessToken();
    const model = process.env.TEXT_EMBEDDING_MODEL ?? 'text-embedding-ada-002';
    const url   = `${this.baseUrl}/v2/inference/deployments/${model}/embeddings`;

    const res = await fetch(url, {
      method:  'POST',
      headers: {
        'Authorization':     `Bearer ${token}`,
        'Content-Type':      'application/json',
        'AI-Resource-Group': this.resourceGroup,
      },
      body: JSON.stringify({ input: texts }),
    });
    if (!res.ok) throw new Error(`AI Core embeddings failed: ${res.status}`);

    const json = await res.json() as { data: Array<{ embedding: number[] }> };
    return json.data.map(d => d.embedding);
  }
}
