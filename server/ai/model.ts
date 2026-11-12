// Model client: the runtime talks to this interface only, so the agent loop can be swapped (SDK spike) without
// touching approvals, budgets or audit. AnthropicClient uses plain fetch (no new package).
export interface ToolSpec { name: string; description: string; input_schema: Record<string, unknown> }
export type Block = { type: "text"; text: string } | { type: "tool_use"; id: string; name: string; input: any } | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };
export interface Message { role: "user" | "assistant"; content: string | Block[] }
export interface ModelReply { content: Block[]; stopReason: string; inputTokens: number; outputTokens: number }
export interface ModelClient { complete(req: { model: string; system: string; messages: Message[]; tools: ToolSpec[]; maxTokens: number }): Promise<ModelReply> }

export class AnthropicClient implements ModelClient {
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  constructor(apiKey: string, fetchImpl: typeof fetch = fetch) {
    if (!apiKey) throw new Error("AI_NOT_CONFIGURED");
    this.apiKey = apiKey; this.fetchImpl = fetchImpl;
  }
  async complete(req: { model: string; system: string; messages: Message[]; tools: ToolSpec[]; maxTokens: number }): Promise<ModelReply> {
    const res = await this.fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": this.apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: req.model, max_tokens: req.maxTokens, system: req.system, messages: req.messages, ...(req.tools.length ? { tools: req.tools } : {}) })
    });
    if (!res.ok) throw new Error(`AI_PROVIDER_${res.status}`);
    const body = await res.json() as any;
    return { content: Array.isArray(body.content) ? body.content : [], stopReason: String(body.stop_reason ?? ""), inputTokens: Number(body.usage?.input_tokens ?? 0), outputTokens: Number(body.usage?.output_tokens ?? 0) };
  }
}
