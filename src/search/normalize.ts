import { CJK_FOLD_PAIRS } from './cjkFold.ts';

const characters = Array.from(CJK_FOLD_PAIRS);
const folds = new Map<string, string>();
for (let i = 0; i < characters.length; i += 2) folds.set(characters[i]!, characters[i + 1]!);

// Every fold source lies in these blocks (checked against cjkFold.ts), so other text skips the per-character pass.
const han = /[\u2e80-\u9fff\uf900-\ufaff\u{20000}-\u{3ffff}]/u;
const printableAscii = /^[\x20-\x7e]*$/;

/** Fold only Chinese/Japanese character variants, preserving display punctuation and case. */
export function foldCjk(text: string): string {
  return han.test(text) ? Array.from(text, (character) => folds.get(character) ?? character).join('') : text;
}

export function normalize(text: string): string {
  // NFKD and mark stripping are identities on printable ASCII, the bulk of place names.
  const decomposed = printableAscii.test(text) ? text : text.normalize('NFKD').replace(/[\u0300-\u036f]/gu, '');
  return foldCjk(decomposed.toLowerCase().replace(/[\p{P}\s]+/gu, ' ').trim());
}
