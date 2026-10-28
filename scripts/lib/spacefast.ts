// Minimal Spacefast API client: WP-CLI against a space. The token is only ever sent as a header.
export interface SpacefastApi {
  wpCli(spaceId: string, args: string[]): Promise<{ ok: boolean }>;
}

const API = 'https://api.spacefast.com';

/** `ok` is true only when the host ran WP-CLI and it exited zero (data.status === "succeeded"). */
export function httpSpacefastApi(token: string, fetchFn: typeof fetch = fetch): SpacefastApi {
  return {
    async wpCli(spaceId, args) {
      const res = await fetchFn(`${API}/v1/spaces/${encodeURIComponent(spaceId)}/wp-cli`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ args }),
      });
      if (!res.ok) return { ok: false };
      const body = (await res.json().catch(() => null)) as { data?: { status?: string } } | null;
      return { ok: body?.data?.status === 'succeeded' };
    },
  };
}
