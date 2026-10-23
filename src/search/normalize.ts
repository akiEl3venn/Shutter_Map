import { CJK_FOLD_PAIRS } from './cjkFold.ts';

const characters = Array.from(CJK_FOLD_PAIRS);
const folds = new Map<string, string>();
for (let i = 0; i < characters.length; i += 2) folds.set(characters[i]!, characters[i + 1]!);

/** Fold only Chinese/Japanese character variants, preserving display punctuation and case. */
export function foldCjk(text: string): string {
  return Array.from(text, (character) => folds.get(character) ?? character).join('');
}

export function normalize(text: string): string {
  return foldCjk(text.normalize('NFKD').replace(/[\u0300-\u036f]/gu, '').toLowerCase()
    .replace(/[\p{P}\s]+/gu, ' ').trim());
}
