export type Task = 'placement' | 'judge' | 'tutor' | 'feedback';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export interface ChatOptions {
  model: string;
  messages: ChatMessage[];
  maxTokens: number;
  /** JSON schema the reply must satisfy. */
  json?: object;
}

export interface StreamOptions {
  model: string;
  messages: ChatMessage[];
  maxTokens: number;
}

export interface Provider {
  id: 'workers-ai' | 'anthropic';
  chat(o: ChatOptions): Promise<{ text: string; usage: Usage }>;
  stream(o: StreamOptions): Promise<{ body: ReadableStream<string>; usage: Promise<Usage> }>;
}

/** Fallback token estimate when a provider omits usage: ceil(chars / 4). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function estimateInputTokens(messages: ChatMessage[]): number {
  return estimateTokens(messages.map((m) => m.content).join(''));
}

/**
 * Turns an SSE byte stream into a stream of `data:` payload strings.
 * Handles chunks split anywhere, CRLF, and a trailing event without a blank line.
 */
export function sseData(res: Response): ReadableStream<string> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const flush = (ctl: ReadableStreamDefaultController<string>, final: boolean) => {
    const parts = buf.split(/\r?\n\r?\n/);
    buf = final ? '' : (parts.pop() ?? '');
    for (const ev of parts) {
      const data = ev
        .split(/\r?\n/)
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).replace(/^ /, ''))
        .join('\n');
      if (data) ctl.enqueue(data);
    }
  };
  return new ReadableStream<string>({
    async pull(ctl) {
      const { done, value } = await reader.read();
      if (done) {
        buf += dec.decode();
        flush(ctl, true);
        ctl.close();
        return;
      }
      buf += dec.decode(value, { stream: true });
      flush(ctl, false);
    },
    cancel: () => reader.cancel(),
  });
}
