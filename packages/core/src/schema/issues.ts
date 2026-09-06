// Validation issues and the typed error parseFile throws (spec §5, §7.4, §14).

export type IssueLevel = 'refusal' | 'warning';

export interface Issue {
  level: IssueLevel;
  /** repo-relative path the issue is about */
  path: string;
  /** stable rule id, e.g. `field.required`; tests key on it */
  rule: string;
  message: string;
}

export class ValidationError extends Error {
  override name = 'ValidationError';
  constructor(public readonly issues: Issue[]) {
    super(issues.map((i) => `${i.path}: ${i.message}`).join('\n'));
  }
}

export const refusal = (path: string, rule: string, message: string): Issue => ({ level: 'refusal', path, rule, message });
export const warning = (path: string, rule: string, message: string): Issue => ({ level: 'warning', path, rule, message });
