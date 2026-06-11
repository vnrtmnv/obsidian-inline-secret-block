export type BlockKind = 'secret' | 'secret-lock';

export interface Block {
	kind: BlockKind;
	startLine: number;
	endLine: number;
	indent: string;
	fenceLen: number;
	info: string;
	body: string;
}

export function findBlocks(text: string, kind: BlockKind): Block[] {
	const lines = text.split('\n');
	const blocks: Block[] = [];
	let i = 0;
	while (i < lines.length) {
		const open = matchOpenFence(lines[i]!, kind);
		if (!open) {
			i++;
			continue;
		}
		const closeLine = findCloseFence(lines, i + 1, open.indent, open.fenceLen);
		if (closeLine === -1) {
			i++;
			continue;
		}
		const bodyLines = lines.slice(i + 1, closeLine);
		const body = bodyLines.map((l) => stripIndent(l, open.indent)).join('\n');
		blocks.push({
			kind,
			startLine: i,
			endLine: closeLine,
			indent: open.indent,
			fenceLen: open.fenceLen,
			info: open.info,
			body,
		});
		i = closeLine + 1;
	}
	return blocks;
}

export function replaceBlocks(
	text: string,
	blocks: readonly Block[],
	render: (b: Block) => string,
): string {
	if (blocks.length === 0) return text;

	const lines = text.split('\n');
	const parts: string[] = [];
	let cursor = 0;

	for (const b of blocks) {
		if (cursor < b.startLine) {
			parts.push(lines.slice(cursor, b.startLine).join('\n'));
			parts.push('\n');
		}
		parts.push(render(b));
		cursor = b.endLine + 1;
	}
	if (cursor < lines.length) {
		parts.push('\n');
		parts.push(lines.slice(cursor).join('\n'));
	}
	return parts.join('');
}

export function renderSecretLock(
	indent: string,
	fenceLen: number,
	payloadB64: string,
	info: string = '',
): string {
	const fence = '`'.repeat(fenceLen);
	const suffix = info.length > 0 ? ` ${info}` : '';
	return `${indent}${fence}secret-lock${suffix}\n${indent}${payloadB64}\n${indent}${fence}`;
}

export function renderSecret(
	indent: string,
	fenceLen: number,
	body: string,
	info: string = '',
): string {
	const fence = '`'.repeat(fenceLen);
	const suffix = info.length > 0 ? ` ${info}` : '';
	const indented = body
		.split('\n')
		.map((l) => (l.length === 0 ? l : indent + l))
		.join('\n');
	return `${indent}${fence}secret${suffix}\n${indented}\n${indent}${fence}`;
}

export function parseInfoString(line: string, kind: BlockKind): string {
	const m = /^\s*`{3,}([^\s`]+)(?:\s+(.*?))?\s*$/.exec(line);
	if (!m) return '';
	if (m[1] !== kind) return '';
	return (m[2] ?? '').trim();
}

interface OpenMatch {
	indent: string;
	fenceLen: number;
	info: string;
}

function matchOpenFence(line: string, kind: BlockKind): OpenMatch | null {
	const m = /^(\s*)(`{3,})([^\s`]+)(?:\s+(.*?))?\s*$/.exec(line);
	if (!m) return null;
	const indent = m[1]!;
	const fence = m[2]!;
	const lang = m[3]!;
	if (lang !== kind) return null;
	const info = (m[4] ?? '').trim();
	return { indent, fenceLen: fence.length, info };
}

function findCloseFence(
	lines: string[],
	from: number,
	indent: string,
	fenceLen: number,
): number {
	for (let i = from; i < lines.length; i++) {
		const m = /^(\s*)(`{3,})\s*$/.exec(lines[i]!);
		if (!m) continue;
		const lineIndent = m[1]!;
		const fence = m[2]!;
		if (lineIndent === indent && fence.length >= fenceLen) {
			return i;
		}
	}
	return -1;
}

function stripIndent(line: string, indent: string): string {
	if (indent.length > 0 && line.startsWith(indent)) {
		return line.slice(indent.length);
	}
	return line;
}
