// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';
import { newRecord } from '../../src/record/../shared/record';
import { downloadRecord } from '../../src/record/fileTransfer';

it('downloadRecord clicks a temporary link with a json blob', () => {
  const create = vi.fn(() => 'blob:x');
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() }));
  let download = '';
  const orig = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) { download = this.download; };
  downloadRecord(newRecord());
  HTMLAnchorElement.prototype.click = orig;
  expect(download).toBe('learn-wp-record.json');
  expect(create).toHaveBeenCalledOnce();
  expect(document.querySelector('a')).toBeNull();
});
