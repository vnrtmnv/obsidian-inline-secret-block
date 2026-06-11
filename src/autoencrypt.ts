import { EditorView } from '@codemirror/view';
import {
	App,
	Editor,
	MarkdownView,
	Notice,
	Plugin,
	debounce,
} from 'obsidian';
import { Block, findBlocks, renderSecretLock, replaceBlocks } from './blocks';
import { encrypt } from './crypto';
import { KeyStore } from './keystore';
import { KeyChoice, KeyChoiceModal, PassphraseModal } from './modal';

export interface AutoEncryptCtx {
	app: App;
	plugin: Plugin;
	keystore: KeyStore;
	intendedKeys: Map<string, string>;
}

const DEBOUNCE_MS = 1500;
const PROMPT_THROTTLE_MS = 5000;

export function setupAutoEncrypt(ctx: AutoEncryptCtx): void {
	let busy = false;
	let programmaticWrite = false;
	let lastPromptAt = 0;
	let wasInsideSecret = false;

	const cursorInsideBlock = (line: number, blocks: Block[]): boolean =>
		blocks.some((b) => line > b.startLine && line < b.endLine);

	const tryPrompt = async (editor: Editor): Promise<void> => {
		if (busy || programmaticWrite) return;
		if (Date.now() - lastPromptAt < PROMPT_THROTTLE_MS) return;

		const text = editor.getValue();
		const blocks = findBlocks(text, 'secret');
		if (blocks.length === 0) return;
		const cursorLine = editor.getCursor().line;

		const target = blocks.find(
			(b) =>
				b.body.length > 0 &&
				!(cursorLine > b.startLine && cursorLine < b.endLine),
		);
		if (!target) return;

		busy = true;
		try {
			await promptAndEncrypt(editor, target);
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

	const promptAndEncrypt = (
		editor: Editor,
		block: Block,
	): Promise<void> => {
		return new Promise((resolve) => {
			const finish = async (passphrase: string) => {
				try {
					await applyEncryption(editor, block, passphrase);
				} catch (e) {
					new Notice(`Encryption failed: ${(e as Error).message}`);
				}
				resolve();
			};

			const cancel = () => resolve();

			const activeFile =
				ctx.app.workspace.getActiveViewOfType(MarkdownView)?.file ?? null;
			const filePath = activeFile?.path ?? null;
			if (filePath !== null) {
				const stickyId = ctx.intendedKeys.get(filePath);
				if (stickyId !== undefined) {
					const passphrase = ctx.keystore.getPassphrase(stickyId);
					if (passphrase !== null) {
						void finish(passphrase);
						return;
					}
					ctx.intendedKeys.delete(filePath);
				}
			}

			const keys = ctx.keystore.list();

			if (keys.length === 0) {
				new PassphraseModal(ctx.app, {
					title: 'Encrypt block with new passphrase',
					onSubmit: (passphrase) => {
						void finish(passphrase);
					},
					onCancel: cancel,
				}).open();
			} else {
				new KeyChoiceModal(ctx.app, {
					keys,
					onChoose: (choice: KeyChoice) => {
						if (choice.kind === 'existing') {
							const passphrase = ctx.keystore.getPassphrase(choice.id);
							if (passphrase === null) {
								new Notice('Selected key is no longer in store');
								resolve();
								return;
							}
							void finish(passphrase);
						} else {
							void finish(choice.passphrase);
						}
					},
					onCancel: cancel,
				}).open();
			}
		});
	};

	const applyEncryption = async (
		editor: Editor,
		block: Block,
		passphrase: string,
	): Promise<void> => {
		const entry = await ctx.keystore.add(passphrase);
		const activeFile =
			ctx.app.workspace.getActiveViewOfType(MarkdownView)?.file ?? null;
		if (activeFile) ctx.intendedKeys.set(activeFile.path, entry.id);
		const ciphertext = await encrypt(block.body, passphrase);
		const currentText = editor.getValue();
		const blocks = findBlocks(currentText, 'secret');
		const match = blocks.find(
			(b) =>
				b.startLine === block.startLine &&
				b.indent === block.indent &&
				b.body === block.body,
		);
		if (!match) {
			new Notice('Block changed before encryption; skipped');
			return;
		}
		const newText = replaceBlocks(currentText, [match], (b) =>
			renderSecretLock(b.indent, b.fenceLen, ciphertext, b.info),
		);
		programmaticWrite = true;
		try {
			editor.setValue(newText);
		} finally {
			programmaticWrite = false;
		}
	};
}
