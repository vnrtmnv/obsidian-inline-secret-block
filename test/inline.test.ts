import { describe, it, expect } from 'vitest';
import {
	findFenceRanges,
	findInlineSecrets,
	renderInlinePlain,
	renderInlineSecretLock,
} from '../src/inline';

describe('findInlineSecrets', () => {
	it('finds an inline secret with correct coordinates and body', () => {
		const text = 'password: `secret 1234`';
		const found = findInlineSecrets(text, 'secret');
		expect(found).toHaveLength(1);
		expect(found[0]).toMatchObject({
			kind: 'secret',
			line: 0,
			chStart: 10,
			chEnd: 23,
			body: '1234',
		});
		// the captured range is exactly the code span
		expect(text.slice(found[0]!.chStart, found[0]!.chEnd)).toBe(
			'`secret 1234`',
		);
	});

	it('finds an inline secret-lock span', () => {
		const text = 'token: `secret-lock QUFB`';
		const found = findInlineSecrets(text, 'secret-lock');
		expect(found).toHaveLength(1);
		expect(found[0]?.body).toBe('QUFB');
	});

	it('does not confuse `secret ` with `secret-lock `', () => {
		const text = '`secret plain` and `secret-lock CT`';
		expect(findInlineSecrets(text, 'secret').map((s) => s.body)).toEqual([
			'plain',
		]);
		expect(findInlineSecrets(text, 'secret-lock').map((s) => s.body)).toEqual([
			'CT',
		]);
	});

	it('finds multiple inline secrets on one line', () => {
		const text = '`secret a` x `secret b`';
		expect(findInlineSecrets(text, 'secret').map((s) => s.body)).toEqual([
			'a',
			'b',
		]);
	});

	it('ignores double/triple backtick spans (look-behind/ahead)', () => {
		expect(findInlineSecrets('``secret x``', 'secret')).toHaveLength(0);
	});

	it('requires a non-empty body', () => {
		expect(findInlineSecrets('`secret `', 'secret')).toHaveLength(0);
	});

	it('skips inline spans inside fenced code blocks', () => {
		const text = ['```js', 'const a = `secret nope`;', '```', '`secret yes`'].join(
			'\n',
		);
		const found = findInlineSecrets(text, 'secret');
		expect(found).toHaveLength(1);
		expect(found[0]?.body).toBe('yes');
		expect(found[0]?.line).toBe(3);
	});
});

describe('findFenceRanges', () => {
	it('reports inclusive 0-based line ranges of fenced blocks', () => {
		const text = ['a', '```', 'x', '```', 'b'].join('\n');
		expect(findFenceRanges(text)).toEqual([[1, 3]]);
	});

	it('treats an unterminated fence as running to the end', () => {
		const text = ['a', '```', 'x'].join('\n');
		expect(findFenceRanges(text)).toEqual([[1, 2]]);
	});

	it('returns nothing when there are no fences', () => {
		expect(findFenceRanges('just text\nmore text')).toEqual([]);
	});
});

describe('render inline', () => {
	it('renders secret-lock and plain inline spans', () => {
		expect(renderInlineSecretLock('CT')).toBe('`secret-lock CT`');
		expect(renderInlinePlain('1234')).toBe('`secret 1234`');
	});

	it('round-trips renderInlinePlain -> findInlineSecrets', () => {
		const rendered = renderInlinePlain('hunter2');
		expect(findInlineSecrets(rendered, 'secret')[0]?.body).toBe('hunter2');
	});
});
