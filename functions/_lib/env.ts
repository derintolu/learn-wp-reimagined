export interface D1Stmt {
  bind(...v: unknown[]): D1Stmt;
  all<T>(): Promise<{ results: T[] }>;
  first<T>(): Promise<T | null>;
  run(): Promise<{ meta: { changes: number } }>;
}

export interface D1Like {
  prepare(sql: string): D1Stmt;
}

export interface Env {
  DB: D1Like;
  CF_ACCOUNT_ID?: string;
  CF_AI_TOKEN?: string;
  ANTHROPIC_API_KEY?: string;
  ADMIN_TOKEN?: string;
  AI_ROUTES?: string;
  /** Header carrying the real client IP behind the edge; defaults to cf-connecting-ip. */
  TRUSTED_IP_HEADER?: string;
  /** Bearer token the daily /api/mcp-sweep cron must send. */
  CRON_SECRET?: string;
  /** HMAC key for hashing session cookies; sessions are off without it. */
  SESSION_KEY?: string;
  /** Learning Ledger connector: Ed25519 private key, PKCS8 base64. */
  CONNECTOR_SIGNING_KEY?: string;
  /** Key id of that key, as trusted by the ledger. */
  CONNECTOR_KEY_ID?: string;
  /** Ledger's ping public key (raw 32 bytes, base64). */
  CONNECTOR_PING_PUBLIC_KEY?: string;
  /** Learning Ledger LRS client key and secret (HTTP Basic); the LRS client is unavailable without both. */
  LRS_KEY?: string;
  LRS_SECRET?: string;
}

export type Handler = (
  req: Request,
  ctx: { params: Record<string, string>; env: Env },
) => Promise<Response>;
