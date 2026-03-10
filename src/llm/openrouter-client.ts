/**
 * @module llm/openrouter-client
 * @description OpenRouter API client for LLM interactions. Supports text
 * and vision (multimodal) chat completions with retry logic.
 */

// ── Types ───────────────────────────────────────────────────────────────

/** A single message in the chat conversation */
export interface Message {
  /** Message role */
  role: 'system' | 'user' | 'assistant';
  /** Message content (text or multimodal content array) */
  content: string | MessageContent[];
}

/** Multimodal content part (text or image) */
export interface MessageContent {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string };
}

/** Options for a chat completion request */
export interface ChatOpts {
  /** Model identifier override */
  model?: string;
  /** Sampling temperature (0-2) */
  temperature?: number;
  /** Maximum tokens to generate */
  maxTokens?: number;
  /** Response format constraint */
  responseFormat?: { type: 'json_object' } | { type: 'text' };
}

/** Response from a chat completion */
export interface ChatResponse {
  /** Generated text content */
  content: string;
  /** Model that produced the response */
  model: string;
  /** Token usage */
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// ── Constants ───────────────────────────────────────────────────────────

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;

// ── Client ──────────────────────────────────────────────────────────────

/**
 * Client for the OpenRouter API, supporting text and vision chat completions.
 */
export class OpenRouterClient {
  private readonly apiKey: string;
  private readonly defaultModel: string;

  /**
   * @param apiKey - OpenRouter API key
   * @param defaultModel - Default model to use (e.g., 'google/gemini-2.0-flash-001')
   */
  constructor(apiKey: string, defaultModel?: string) {
    this.apiKey = apiKey;
    this.defaultModel = defaultModel ?? 'google/gemini-2.0-flash-001';
  }

  /**
   * Send a chat completion request.
   * @param messages - Conversation messages
   * @param opts - Optional parameters
   * @returns The chat response with content and usage
   */
  async chat(messages: Message[], opts?: ChatOpts): Promise<ChatResponse> {
    const body = {
      model: opts?.model ?? this.defaultModel,
      messages,
      temperature: opts?.temperature ?? 0.3,
      max_tokens: opts?.maxTokens ?? 4096,
      ...(opts?.responseFormat ? { response_format: opts.responseFormat } : {}),
    };

    return this._requestWithRetry(body);
  }

  /**
   * Send a chat completion with image inputs for vision analysis.
   * @param messages - Conversation messages (text)
   * @param images - Image buffers to include as vision input
   * @param opts - Optional parameters
   * @returns The chat response
   */
  async chatWithVision(
    messages: Message[],
    images: Buffer[],
    opts?: ChatOpts,
  ): Promise<ChatResponse> {
    // Convert images to base64 data URLs and append to the last user message
    const imageContents: MessageContent[] = images.map((img) => ({
      type: 'image_url' as const,
      image_url: { url: `data:image/jpeg;base64,${img.toString('base64')}` },
    }));

    // Build multimodal message
    const lastUserMsg = [...messages].reverse().find((m: Message) => m.role === 'user');
    if (lastUserMsg) {
      const textContent: MessageContent = {
        type: 'text',
        text: typeof lastUserMsg.content === 'string' ? lastUserMsg.content : '',
      };
      lastUserMsg.content = [textContent, ...imageContents];
    }

    return this.chat(messages, opts);
  }

  /**
   * Estimate the cost of an API call based on token counts and model.
   * @param inputTokens - Number of input tokens
   * @param outputTokens - Number of output tokens
   * @param model - Model identifier
   * @returns Estimated cost in USD
   */
  estimateCost(inputTokens: number, outputTokens: number, model: string): number {
    // TODO: Implement model-specific pricing lookup
    // Placeholder: rough estimate based on typical pricing
    const inputCostPer1k = model.includes('gemini') ? 0.00015 : 0.001;
    const outputCostPer1k = model.includes('gemini') ? 0.0006 : 0.003;
    return (inputTokens / 1000) * inputCostPer1k + (outputTokens / 1000) * outputCostPer1k;
  }

  /**
   * Make an API request with exponential backoff retry logic.
   * @param body - Request body
   * @returns Chat response
   */
  private async _requestWithRetry(body: Record<string, unknown>): Promise<ChatResponse> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const response = await fetch(OPENROUTER_API_URL, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://github.com/Mnehmos/mnehmos.ffmpeg-llm.mcp',
            'X-Title': 'FFmpeg-LLM MCP',
          },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          const errorText = await response.text();
          // Retry on rate limit or server errors
          if (response.status === 429 || response.status >= 500) {
            lastError = new Error(`API error ${response.status}: ${errorText}`);
            await this._sleep(INITIAL_BACKOFF_MS * Math.pow(2, attempt));
            continue;
          }
          throw new Error(`OpenRouter API error ${response.status}: ${errorText}`);
        }

        const data = (await response.json()) as {
          choices: Array<{ message: { content: string } }>;
          model: string;
          usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
        };

        return {
          content: data.choices[0]?.message?.content ?? '',
          model: data.model,
          usage: data.usage,
        };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < MAX_RETRIES - 1) {
          await this._sleep(INITIAL_BACKOFF_MS * Math.pow(2, attempt));
        }
      }
    }

    throw lastError ?? new Error('Request failed after retries');
  }

  /** Sleep for the given number of milliseconds */
  private _sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
