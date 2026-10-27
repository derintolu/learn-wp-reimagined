export const GET = async (req: Request): Promise<Response> => {
  const host = new URL(req.url).host;
  try {
    const res = await fetch(`https://${host}/wp-json/lwr-spike/v1/ping`);
    const body = (await res.text()).slice(0, 2000);
    return Response.json({ status: res.status, body });
  } catch (e) {
    return Response.json({ status: 0, body: e instanceof Error ? e.message : 'fetch failed' });
  }
};
