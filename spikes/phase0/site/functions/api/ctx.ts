export const GET = async (_req: Request, ctx: Record<string, unknown>): Promise<Response> =>
  Response.json({ keys: Object.keys(ctx ?? {}) });
