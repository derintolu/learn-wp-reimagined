export const GET = async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  return Response.json({ spike: true, path: url.pathname });
};
