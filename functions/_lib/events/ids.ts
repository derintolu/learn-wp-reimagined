/** Statement id n of an event: SHA-256 of `${eventId}:${n}` formatted as a version-8 (RFC 9562) UUID. Retries give identical ids. */
export async function deriveStatementId(eventId: string, n: number): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${eventId}:${n}`)));
  const b = digest.slice(0, 16);
  b[6] = (b[6] & 0x0f) | 0x80;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
