// Vendored from github.com/derintolu/learning-mcp @ f545f5cd68a2c64dc96ac0b138fea6d4332de637, reference/packages/validator/src/explain.ts. Do not edit here; change learning-mcp and re-vendor.
// SPDX-License-Identifier: Apache-2.0
import { ERROR_HELP_BASE, ISSUE_CATALOG } from '../core/index.ts';
import type { IssueCode, Severity } from '../core/index.ts';

export interface CodeExplanation {
  code: IssueCode;
  severity: Severity;
  title: string;
  fix: string;
  help: string;
}

/** The catalog entry for a validator code, or undefined when the code is unknown. */
export function explainCode(code: string): CodeExplanation | undefined {
  if (!Object.hasOwn(ISSUE_CATALOG, code)) return undefined;
  const c = code as IssueCode;
  const e = ISSUE_CATALOG[c];
  return { code: c, severity: e.severity, title: e.title, fix: e.fix, help: ERROR_HELP_BASE + c };
}
