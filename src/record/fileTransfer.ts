import { parseRecord, type LearningRecord } from '../shared/record';

export function downloadRecord(r: LearningRecord): void {
  const blob = new Blob([JSON.stringify(r, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'learn-wp-record.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export async function readRecordFile(f: File): Promise<{ ok: true; record: LearningRecord } | { ok: false; error: string }> {
  let raw: unknown;
  try {
    raw = JSON.parse(await f.text());
  } catch {
    return { ok: false, error: 'This file is not valid JSON' };
  }
  return parseRecord(raw);
}
