import Anthropic from "@anthropic-ai/sdk";
import type { LLMProvider, LLMRequest, LLMResult } from "@aevia/core";

/** Model dari env; default = model Sonnet terbaru yang dikenal SDK saat ini. Ganti lewat ANTHROPIC_MODEL tanpa ubah kode. */
export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-5-5";
export const resolveModel = () => process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_ANTHROPIC_MODEL;

/** Tanpa streaming, tanpa tools: hanya teks. */
export class ClaudeProvider implements LLMProvider {
  private client: Anthropic;
  constructor(
    apiKey: string,
    private model = resolveModel(),
  ) {
    this.client = new Anthropic({ apiKey, maxRetries: 0 });
  }

  async complete(req: LLMRequest): Promise<LLMResult> {
    const res = await this.client.messages.create(
      { model: this.model, max_tokens: req.maxTokens, system: req.system, messages: req.messages },
      { timeout: req.timeoutMs, signal: AbortSignal.timeout(req.timeoutMs) },
    );
    const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
    return { text, model: res.model ?? this.model, usage: { input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens } };
  }
}
