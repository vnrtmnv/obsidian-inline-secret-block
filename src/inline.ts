export type InlineKind = 'secret' | 'secret-lock';

export interface InlineSecret {
	kind: InlineKind;
	line: number;
	chStart: number;
	chEnd: number;
	body: string;
}

const FENCE_OPEN = /^(\s*)(`{3,})/;
const FENCE_CLOSE = /^(\s*)(`{3,})\s*$/;

/**
 * Line ranges (inclusive, 0-based) covered by fenced code blocks of any
 * language. Used to keep the inline scanner from touching backtick spans that
 * live inside fenced code.
 */
export function findFenceRanges(text: string): Array<[number, number]> {
	const lines = text.split('\n');
	const ranges: Array<[number, number]> = [];
	let i = 0;
	while (i < lines.length) {
		const open = FENCE_OPEN.exec(lines[i]!);
		if (!open) {
			i++;
			continue;
		}
		const indent = open[1]!;
		const fenceLen = open[2]!.length;
		let close = -1;
		for (let j = i + 1; j < lines.length; j++) {
			const m = FENCE_CLOSE.exec(lines[j]!);
			if (m && m[1] === indent && m[2]!.length >= fenceLen) {
				close = j;
				break;
			}
		}
		if (close === -1) {
			// Unterminated fence: treat the remainder as fenced, to be safe.
			ranges.push([i, lines.length - 1]);
			break;
		}
		ranges.push([i, close]);
		i = close + 1;
	}
	return ranges;
}

function inlineRegex(kind: InlineKind): RegExp {
	// Body has no backticks, so a single-backtick span is unambiguous on one
	// line. The look-behind/look-ahead reject double/triple-backtick fences.
	return kind === 'secret-lock'
		? /(?<!`)`secret-lock ([^`\n]+)`(?!`)/g
		: /(?<!`)`secret ([^`\n]+)`(?!`)/g;
}

/**
 * Inline `secret`/`secret-lock` code spans on single backticks, skipping any
 * line that sits inside a fenced code block.
 */
export function findInlineSecrets(text: string, kind: InlineKind): InlineSecret[] {
	const lines = text.split('\n');
	const fenced = findFenceRanges(text);
	const isFenced = (line: number): boolean =>
		fenced.some(([a, b]) => line >= a && line <= b);

	const re = inlineRegex(kind);
	const out: InlineSecret[] = [];
	for (let line = 0; line < lines.length; line++) {
		if (isFenced(line)) continue;
		const lineText = lines[line]!;
		re.lastIndex = 0;
		let m: RegExpExecArray | null;
		while ((m = re.exec(lineText)) !== null) {
			out.push({
				kind,
				line,
				chStart: m.index,
				chEnd: m.index + m[0].length,
				body: m[1]!,
			});
		}
	}
	return out;
}

export function renderInlineSecretLock(payloadB64: string): string {
	return `\`secret-lock ${payloadB64}\``;
}

export function renderInlinePlain(body: string): string {
	return `\`secret ${body}\``;
}
