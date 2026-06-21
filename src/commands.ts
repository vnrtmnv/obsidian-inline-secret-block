import { App, Editor, MarkdownView, Notice, Plugin } from 'obsidian';
import {
	MalformedPayloadError,
	WrongPassphraseError,
	clearKeyCache,
	decrypt,
} from './crypto';
import { Block, findBlocks, renderSecret } from './blocks';
import {
	InlineSecret,
	findInlineSecrets,
	renderInlinePlain,
} from './inline';
import { KeyStore } from './keystore';
import { PassphraseModal } from './modal';

export interface CommandContext {
	app: App;
	plugin: Plugin;
	keystore: KeyStore;
	intendedKeys: Map<string, string>;
}

export function registerCommands(ctx: CommandContext): void {
	const { plugin } = ctx;

	plugin.addCommand({
		id: 'decrypt-current-note',
		name: 'Decrypt secret-lock blocks in current note',
		editorCallback: (editor) => {
			void runDecrypt(ctx, editor);
		},
	});

	plugin.addCommand({
		id: 'forget-passphrase',
		name: 'Forget all passphrases',
		callback: () => {
			ctx.keystore.clear();
			ctx.intendedKeys.clear();
			clearKeyCache();
			new Notice('All passphrases forgotten');
		},
	});
}

type Target =
	| { kind: 'block'; block: Block }
	| { kind: 'inline'; inline: InlineSecret };

interface RangeEdit {
	fromLine: number;
	fromCh: number;
	toLine: number;
	toCh: number;
	text: string;
}

async function runDecrypt(ctx: CommandContext, editor: Editor): Promise<void> {
	const text = editor.getValue();
	const blocks = findBlocks(text, 'secret-lock');
	const inlines = findInlineSecrets(text, 'secret-lock');
	if (blocks.length === 0 && inlines.length === 0) {
		new Notice('No secret-lock blocks found');
		return;
	}

	const targets: Target[] = [
		...blocks.map((block): Target => ({ kind: 'block', block })),
		...inlines.map((inline): Target => ({ kind: 'inline', inline })),
	];
	const payloadOf = (t: Target): string =>
		t.kind === 'block' ? t.block.body : t.inline.body;

	const plaintexts: (string | null)[] = targets.map(() => null);
	let pending = 0;
	let lastUsedId: string | null = null;

	for (let i = 0; i < targets.length; i++) {
		try {
			const hit = await ctx.keystore.tryDecrypt(payloadOf(targets[i]!));
			if (hit !== null) {
				plaintexts[i] = hit.plaintext;
				lastUsedId = hit.id;
			} else {
				pending++;
			}
		} catch (e) {
			if (e instanceof MalformedPayloadError) {
				new Notice(`A secret-lock block is corrupted: ${e.message}`);
				return;
			}
			throw e;
		}
	}

	if (pending > 0) {
		const passphrase = await promptPassphrase(ctx.app);
		if (passphrase === null) return;

		for (let i = 0; i < targets.length; i++) {
			if (plaintexts[i] !== null) continue;
			try {
				plaintexts[i] = await decrypt(payloadOf(targets[i]!), passphrase);
			} catch (e) {
				if (e instanceof WrongPassphraseError) {
					new Notice('Wrong passphrase');
					return;
				}
				if (e instanceof MalformedPayloadError) {
					new Notice(`A secret-lock block is corrupted: ${e.message}`);
					return;
				}
				throw e;
			}
		}
		const entry = await ctx.keystore.add(passphrase);
		lastUsedId = entry.id;
	}

	if (lastUsedId !== null) {
		const path = ctx.app.workspace.getActiveViewOfType(MarkdownView)?.file
			?.path;
		if (path) ctx.intendedKeys.set(path, lastUsedId);
	}

	const edits: RangeEdit[] = targets.map((t, i): RangeEdit => {
		const plain = plaintexts[i]!;
		if (t.kind === 'block') {
			const b = t.block;
			return {
				fromLine: b.startLine,
				fromCh: 0,
				toLine: b.endLine,
				toCh: editor.getLine(b.endLine).length,
				text: renderSecret(b.indent, b.fenceLen, plain, b.info),
			};
		}
		const s = t.inline;
		return {
			fromLine: s.line,
			fromCh: s.chStart,
			toLine: s.line,
			toCh: s.chEnd,
			text: renderInlinePlain(plain),
		};
	});

	// Apply bottom-up so earlier ranges keep their coordinates. Scroll position
	// is preserved because we never call editor.setValue().
	edits.sort((a, b) => b.fromLine - a.fromLine || b.fromCh - a.fromCh);
	for (const e of edits) {
		editor.replaceRange(
			e.text,
			{ line: e.fromLine, ch: e.fromCh },
			{ line: e.toLine, ch: e.toCh },
		);
	}
	new Notice(`Decrypted ${targets.length} secret(s)`);
}

function promptPassphrase(app: App): Promise<string | null> {
	return new Promise((resolve) => {
		new PassphraseModal(app, {
			title: 'Enter passphrase',
			onSubmit: (v) => resolve(v),
			onCancel: () => resolve(null),
		}).open();
	});
}
