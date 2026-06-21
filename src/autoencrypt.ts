import { EditorView } from '@codemirror/view';
import {
	App,
	Editor,
	MarkdownView,
	Notice,
	Plugin,
	debounce,
} from 'obsidian';
import { Block, findBlocks, renderSecretLock } from './blocks';
import { encrypt } from './crypto';
import {
	InlineSecret,
	findInlineSecrets,
	renderInlineSecretLock,
} from './inline';
import { KeyEntry, KeyStore } from './keystore';
import { KeyChoice, KeyChoiceModal, PassphraseModal } from './modal';

export interface AutoEncryptCtx {
	app: App;
	plugin: Plugin;
	keystore: KeyStore;
	intendedKeys: Map<string, string>;
	reEncryptKeys: Map<string, string>;
}

type Candidate =
	| { type: 'block'; block: Block }
	| { type: 'inline'; inline: InlineSecret };

const DEBOUNCE_MS = 1500;
const PROMPT_THROTTLE_MS = 5000;

export function setupAutoEncrypt(ctx: AutoEncryptCtx): void {
	let busy = false;
	let programmaticWrite = false;
	let lastPromptAt = 0;
	let wasInsideSecret = false;

	const activeFilePath = (): string | null =>
		ctx.app.workspace.getActiveViewOfType(MarkdownView)?.file?.path ?? null;

	const cursorInsideBlock = (line: number, blocks: Block[]): boolean =>
		blocks.some((b) => line > b.startLine && line < b.endLine);

	const findCandidate = (editor: Editor): Candidate | null => {
		const text = editor.getValue();
		const cursor = editor.getCursor();

		const block = findBlocks(text, 'secret').find(
			(b) =>
				b.body.length > 0 &&
				!(cursor.line > b.startLine && cursor.line < b.endLine),
		);
		if (block) return { type: 'block', block };

		const inline = findInlineSecrets(text, 'secret').find(
			(s) =>
				!(
					cursor.line === s.line &&
					cursor.ch >= s.chStart &&
					cursor.ch <= s.chEnd
				),
		);
		if (inline) return { type: 'inline', inline };

		return null;
	};

	const tryPrompt = async (editor: Editor): Promise<void> => {
		if (busy || programmaticWrite) return;
		if (Date.now() - lastPromptAt < PROMPT_THROTTLE_MS) return;

		const candidate = findCandidate(editor);
		if (!candidate) return;

		busy = true;
		try {
			const passphrase = await resolvePassphrase(activeFilePath());
			if (passphrase === null) return;
			if (candidate.type === 'block') {
				await applyBlockEncryption(editor, candidate.block, passphrase);
			} else {
				await applyInlineEncryption(editor, candidate.inline, passphrase);
			}
		} catch (e) {
			new Notice(`Encryption failed: ${(e as Error).message}`);
		} finally {
			busy = false;
			lastPromptAt = Date.now();
		}
	};

	const debouncedTryPrompt = debounce(
		(editor: Editor) => {
			void tryPrompt(editor);
		},
		DEBOUNCE_MS,
		false,
	);

	ctx.plugin.registerEvent(
		ctx.app.workspace.on('editor-change', (editor) => {
			if (busy || programmaticWrite) return;
			debouncedTryPrompt(editor);
		}),
	);

	ctx.plugin.registerEditorExtension([
		EditorView.updateListener.of((update) => {
			if (!update.selectionSet && !update.docChanged) return;
			const view = ctx.app.workspace.getActiveViewOfType(MarkdownView);
			if (!view) return;
			const editor = view.editor;
			const blocks = findBlocks(editor.getValue(), 'secret');
			const cursorLine = editor.getCursor().line;
			const inside = cursorInsideBlock(cursorLine, blocks);
			const exited = wasInsideSecret && !inside;
			wasInsideSecret = inside;
			if (exited && !busy && !programmaticWrite) {
				void tryPrompt(editor);
			}
		}),
	]);

	const orderKeys = (
		keys: KeyEntry[],
		preferredId: string | undefined,
	): KeyEntry[] => {
		if (!preferredId) return keys;
		const pref = keys.filter((k) => k.id === preferredId);
		if (pref.length === 0) return keys;
		return [...pref, ...keys.filter((k) => k.id !== preferredId)];
	};

	const resolvePassphrase = (
		filePath: string | null,
	): Promise<string | null> => {
		return new Promise((resolve) => {
			// Re-locking a secret that was just decrypted for editing: reuse the
			// same key silently, no prompt. One-shot — consume the hint.
			if (filePath !== null) {
				const reKeyId = ctx.reEncryptKeys.get(filePath);
				if (reKeyId !== undefined) {
					ctx.reEncryptKeys.delete(filePath);
					const passphrase = ctx.keystore.getPassphrase(reKeyId);
					if (passphrase !== null) {
						resolve(passphrase);
						return;
					}
				}
			}

			const keys = ctx.keystore.list();

			if (keys.length === 0) {
				new PassphraseModal(ctx.app, {
					title: 'Encrypt with new passphrase',
					onSubmit: (passphrase) => resolve(passphrase),
					onCancel: () => resolve(null),
				}).open();
				return;
			}

			const preferredId =
				filePath !== null
					? ctx.intendedKeys.get(filePath)
					: undefined;

			new KeyChoiceModal(ctx.app, {
				keys: orderKeys(keys, preferredId),
				preferredId,
				onChoose: (choice: KeyChoice) => {
					if (choice.kind === 'existing') {
						const passphrase = ctx.keystore.getPassphrase(choice.id);
						if (passphrase === null) {
							new Notice('Selected key is no longer in store');
							resolve(null);
							return;
						}
						resolve(passphrase);
					} else {
						resolve(choice.passphrase);
					}
				},
				onCancel: () => resolve(null),
			}).open();
		});
	};

	const rememberKey = async (passphrase: string): Promise<void> => {
		const entry = await ctx.keystore.add(passphrase);
		const filePath = activeFilePath();
		if (filePath) ctx.intendedKeys.set(filePath, entry.id);
	};

	const applyBlockEncryption = async (
		editor: Editor,
		block: Block,
		passphrase: string,
	): Promise<void> => {
		await rememberKey(passphrase);
		const ciphertext = await encrypt(block.body, passphrase);
		const match = findBlocks(editor.getValue(), 'secret').find(
			(b) =>
				b.startLine === block.startLine &&
				b.indent === block.indent &&
				b.body === block.body,
		);
		if (!match) {
			new Notice('Block changed before encryption; skipped');
			return;
		}
		programmaticWrite = true;
		try {
			editor.replaceRange(
				renderSecretLock(
					match.indent,
					match.fenceLen,
					ciphertext,
					match.info,
				),
				{ line: match.startLine, ch: 0 },
				{ line: match.endLine, ch: editor.getLine(match.endLine).length },
			);
		} finally {
			programmaticWrite = false;
		}
	};

	const applyInlineEncryption = async (
		editor: Editor,
		inline: InlineSecret,
		passphrase: string,
	): Promise<void> => {
		await rememberKey(passphrase);
		const ciphertext = await encrypt(inline.body, passphrase);
		const match = findInlineSecrets(editor.getValue(), 'secret').find(
			(s) => s.body === inline.body,
		);
		if (!match) {
			new Notice('Inline secret changed before encryption; skipped');
			return;
		}
		programmaticWrite = true;
		try {
			editor.replaceRange(
				renderInlineSecretLock(ciphertext),
				{ line: match.line, ch: match.chStart },
				{ line: match.line, ch: match.chEnd },
			);
		} finally {
			programmaticWrite = false;
		}
	};
}
