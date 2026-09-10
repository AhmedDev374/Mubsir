import { describe, expect, it } from 'vitest';
import {
	containsArabic,
	directionForDocument,
	directionForText,
	normalizeArabicText
} from './text-direction';

describe('text direction', () => {
	it('detects Arabic from the first strong character', () => {
		expect(directionForText('مبادئ الذكاء الاصطناعي AI')).toBe('rtl');
		expect(directionForText('Chapter 1: مقدمة إلى الذكاء الاصطناعي')).toBe('ltr');
	});

	it('ignores numbers and punctuation before text', () => {
		expect(directionForText('2026 — السنة')).toBe('rtl');
		expect(directionForText('25: Chapter')).toBe('ltr');
	});

	it('keeps a caller-provided fallback for symbol-only text', () => {
		expect(directionForText('١٢٣ — 25', 'rtl')).toBe('rtl');
		expect(directionForDocument('')).toBe('ltr');
	});

	it('identifies Arabic content without changing the source text', () => {
		const source = 'يستخدم Python و JavaScript في تطوير التطبيقات.';
		expect(containsArabic(source)).toBe(true);
		expect(source).toBe('يستخدم Python و JavaScript في تطوير التطبيقات.');
	});

	it('normalizes Arabic PDF presentation forms for browser shaping', () => {
		expect(normalizeArabicText('ﻳﻬﺮب د ﱞ ُوري ُ وأزهﺎر')).toBe('يهرب دٌُّوريُ وأزهار');
		expect(normalizeArabicText('ﻃﻬﻮ اﻟﻨ ْ ّﻌﺎس')).toBe('طهو النّْعاس');
	});
});
