import { Range } from '@codemirror/state';
import {
	Decoration,
	DecorationSet,
	EditorView,
	ViewPlugin,
	ViewUpdate,
	WidgetType,
} from '@codemirror/view';
import { findFenceRanges } from './inline';
import { InlineRenderContext, buildInlineSecretChip } from './inlineRender';

const LOCK_RE = /(?<!`)`secret-lock ([^`\n]+)`(?!`)/g;

class InlineSecretWidget extends WidgetType {
	constructor(
		private readonly ctx: InlineRenderContext,
		private readonly payload: string,
	) {
		super();
	}

	eq(other: InlineSecretWidget): boolean {
		return other.payload === this.payload;
	}

	toDOM(): HTMLElement {
		return buildInlineSecretChip(this.ctx, this.payload);
	}

	ignoreEvent(): boolean {
		return true;
	}
}

function fencedLineNumbers(docText: string): Set<number> {
	const set = new Set<number>();
	for (const [a, b] of findFenceRanges(docText)) {
		// findFenceRanges is 0-based; CM line numbers are 1-based.
		for (let n = a; n <= b; n++) set.add(n + 1);
	}
	return set;
}

/**
 * Live Preview decorations: replace `secret-lock` inline spans with a chip,
 * except when the span overlaps the current selection (so it stays editable).
 */
export function makeInlineLivePreviewExtension(ctx: InlineRenderContext) {
	return ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;

			constructor(view: EditorView) {
				this.decorations = this.build(view);
			}

			update(u: ViewUpdate): void {
				if (u.docChanged || u.selectionSet || u.viewportChanged) {
					this.decorations = this.build(u.view);
				}
			}

			build(view: EditorView): DecorationSet {
				const ranges: Range<Decoration>[] = [];
				const { doc } = view.state;
				const sel = view.state.selection.main;
				const fenced = fencedLineNumbers(doc.toString());

				for (const { from, to } of view.visibleRanges) {
					let pos = from;
					while (pos <= to) {
						const line = doc.lineAt(pos);
						if (!fenced.has(line.number)) {
							LOCK_RE.lastIndex = 0;
							let m: RegExpExecArray | null;
							while ((m = LOCK_RE.exec(line.text)) !== null) {
								const start = line.from + m.index;
								const end = start + m[0].length;
								const overlaps =
									sel.from <= end && sel.to >= start;
								if (!overlaps) {
									ranges.push(
										Decoration.replace({
											widget: new InlineSecretWidget(
												ctx,
												m[1]!,
											),
										}).range(start, end),
									);
								}
							}
						}
						pos = line.to + 1;
					}
				}
				return Decoration.set(ranges, true);
			}
		},
		{ decorations: (v) => v.decorations },
	);
}
