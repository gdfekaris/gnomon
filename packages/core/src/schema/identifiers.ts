// Identifier rules from the schema §3.

/** Alphabet for set slugs and inbox stem suffixes: omits 0 1 o i l (schema §3.2). */
export const SLUG_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz';

/** Every brain's Set 1 has this fixed slug (schema §3.2). */
export const SET_ONE_SLUG = 'ps-g8xw';

const SOURCE_SLUG = /^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/;
const SET_SLUG = new RegExp(`^ps-[${SLUG_ALPHABET}]{4}$`);
const INBOX_STEM = new RegExp(`^\\d{8}-\\d{6}-[${SLUG_ALPHABET}]{3}$`);
const PROPOSAL_ID = /^P-\d{8}-\d{3}$/;

/** Source and principle slugs: lowercase letters, digits, hyphens; 3–60 chars; no leading/trailing hyphen (schema §3.1, §3.3). */
export function isSourceSlug(s: string): boolean {
  return SOURCE_SLUG.test(s) && !s.includes('--');
}
export const isPrincipleSlug = isSourceSlug;

export function isSetSlug(s: string): boolean {
  return SET_SLUG.test(s);
}

/** `<YYYYMMDD>-<HHMMSS>-<3 alphabet chars>` (schema §3.4). */
export function isInboxStem(s: string): boolean {
  return INBOX_STEM.test(s);
}

/** `P-<YYYYMMDD>-<nnn>` (schema §3.5). */
export function isProposalId(s: string): boolean {
  return PROPOSAL_ID.test(s);
}
