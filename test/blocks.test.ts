import { describe, it, expect } from 'vitest';
import {
	findBlocks,
	parseInfoString,
	renderSecret,
	renderSecretLock,
	replaceBlocks,
} from '../src/blocks';

describe('findBlocks', () => {
	it('finds a simple secret block', () => {
		const text = ['before', '```secret', 'a', 'b', '```', 'after'].join('\n');
		const blocks = findBlocks(text, 'secret');
		expect(blocks).toHaveLength(1);
		expect(blocks[0]).toMatchObject({
			kind: 'secret',
			startLine: 1,
			endLine: 4,
			indent: '',
			fenceLen: 3,
			info: '',
			body: 'a\nb',
		});
	});

	it('captures the info-string', () => {
		const text = '```secret my label\nx\n```';
		expect(findBlocks(text, 'secret')[0]?.info).toBe('my label');
	});

	it('strips the block indent from the body and records indent', () => {
		const text = ['- item', '  ```secret', '  a', '  b', '  ```'].join('\n');
		const block = findBlocks(text, 'secret')[0];
		expect(block?.indent).toBe('  ');
		expect(block?.body).toBe('a\nb');
	});

	it('does not match the other kind', () => {
		const text = '```secret-lock\npayload\n```';
		expect(findBlocks(text, 'secret')).toHaveLength(0);
		expect(findBlocks(text, 'secret-lock')).toHaveLength(1);
	});

	it('handles nested triple-backticks via a longer outer fence', () => {
		const text = ['````secret', '```', 'inner', '```', '````'].join('\n');
		const block = findBlocks(text, 'secret')[0];
		expect(block?.fenceLen).toBe(4);
		expect(block?.body).toBe('```\ninner\n```');
	});

	it('finds multiple blocks', () => {
		const text = [
			'```secret',
			'one',
			'```',
			'mid',
			'```secret',
			'two',
			'```',
		].join('\n');
		const blocks = findBlocks(text, 'secret');
		expect(blocks.map((b) => b.body)).toEqual(['one', 'two']);
	});

	it('ignores an unterminated fence', () => {
		const text = '```secret\nno closing fence';
		expect(findBlocks(text, 'secret')).toHaveLength(0);
	});
});

describe('renderSecret / renderSecretLock', () => {
	it('renders a secret block with indent and info', () => {
		expect(renderSecret('  ', 3, 'a\nb', 'lbl')).toBe(
			'  ```secret lbl\n  a\n  b\n  ```',
		);
	});

	it('renders a secret-lock block', () => {
		expect(renderSecretLock('', 3, 'PAYLOAD')).toBe(
			'```secret-lock\nPAYLOAD\n```',
		);
	});

	it('round-trips findBlocks -> renderSecret', () => {
		const body = 'line1\nline2';
		const rendered = renderSecret('', 3, body, '');
		expect(findBlocks(rendered, 'secret')[0]?.body).toBe(body);
	});
});

describe('replaceBlocks', () => {
	it('replaces a block while preserving surrounding text', () => {
		const text = ['before', '```secret', 'x', '```', 'after'].join('\n');
		const blocks = findBlocks(text, 'secret');
		const out = replaceBlocks(text, blocks, (b) =>
			renderSecretLock(b.indent, b.fenceLen, 'CT', b.info),
		);
		expect(out).toBe(
			['before', '```secret-lock', 'CT', '```', 'after'].join('\n'),
		);
	});

	it('is a no-op when there are no blocks', () => {
		const text = 'plain text';
		expect(replaceBlocks(text, [], () => 'x')).toBe(text);
	});
});

describe('parseInfoString', () => {
	it('returns the info for a matching fence line', () => {
		expect(parseInfoString('```secret-lock label here', 'secret-lock')).toBe(
			'label here',
		);
	});

	it('returns empty string when kind does not match', () => {
		expect(parseInfoString('```secret label', 'secret-lock')).toBe('');
	});

	it('returns empty string for a non-fence line', () => {
		expect(parseInfoString('not a fence', 'secret')).toBe('');
	});
});
