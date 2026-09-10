export type TextDirection = 'rtl' | 'ltr';

const ARABIC_LETTER = /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff\ufb50-\ufdff\ufe70-\ufeff]/u;
const LATIN_LETTER = /[A-Za-z]/u;
const ARABIC_MARK = /[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed]/u;

/**
 * Returns the first strong writing direction in logical Unicode text.
 * Numbers, punctuation, and symbols are deliberately ignored so bidi can
 * resolve them from the surrounding Arabic or Latin text.
 */
export function directionForText(text: string, fallback: TextDirection = 'ltr'): TextDirection {
	for (const character of text) {
		if (ARABIC_LETTER.test(character)) return 'rtl';
		if (LATIN_LETTER.test(character)) return 'ltr';
	}
	return fallback;
}

export function containsArabic(text: string): boolean {
	return ARABIC_LETTER.test(text);
}

/**
 * Converts Arabic presentation-form glyphs emitted by some PDF extractors
 * back to ordinary logical Unicode letters. NFKC performs no visual reversal;
 * it only maps compatibility glyphs to their canonical characters. A few PDF
 * text layers also place spaces around harakat, so remove whitespace adjacent
 * to combining marks before browser shaping.
 */
export function normalizeArabicText(text: string): string {
	const normalized = text.normalize('NFKC');
	return normalized.replace(new RegExp(`\\s+(${ARABIC_MARK.source})`, 'gu'), '$1');
}

export function directionForDocument(text: string): TextDirection {
	return directionForText(text);
}
