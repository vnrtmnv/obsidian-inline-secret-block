import {
	App,
	MarkdownPostProcessorContext,
	MarkdownView,
	Notice,
	TFile,
	setIcon,
} from 'obsidian';
import { findBlocks, parseInfoString, renderSecret, replaceBlocks } from './blocks';
import { MalformedPayloadError, WrongPassphraseError, decrypt } from './crypto';
import { KeyStore } from './keystore';
import { PassphraseModal } from './modal';
import { ISBSettings } from './settings';

export interface RenderContext {
	app: App;
	keystore: KeyStore;
	settings: ISBSettings;
	intendedKeys: Map<string, string>;
	reEncryptKeys: Map<string, string>;
}

interface DecryptResult {
	plaintext: string;
	id: string;
}

export function renderSecretLockBlock(
	ctx: RenderContext,
	source: string,
	el: HTMLElement,
	mdCtx?: MarkdownPostProcessorContext,
): void {
	const card = el.createDiv({ cls: 'isb-secret-card' });

	const header = card.createDiv({ cls: 'isb-secret-card__header' });
	const iconEl = header.createSpan({ cls: 'isb-secret-card__icon' });
	setIcon(iconEl, 'lock');
	const label = resolveLabel(el, mdCtx);
	header.createSpan({
		cls: 'isb-secret-card__label',
		text: label,
	});

	const buttons = card.createDiv({ cls: 'isb-secret-card__buttons' });
	const showBtn = buttons.createEl('button', {
		text: 'Show',
		cls: 'isb-secret-card__btn',
	});
	const editBtn = buttons.createEl('button', {
		text: 'Edit',
		cls: 'isb-secret-card__btn',
	});
	const copyBtn = buttons.createEl('button', {
		text: 'Copy',
		cls: 'isb-secret-card__btn',
	});

	const pre = card.createEl('pre', { cls: 'isb-secret-card__pre' });
	pre.hide();

	const errorEl = card.createDiv({ cls: 'isb-secret-card__error' });
	errorEl.hide();

	let plaintext: string | null = null;
	let currentKeyId: string | null = null;
	let state: 'hidden' | 'shown' | 'error' = 'hidden';

	const setHidden = () => {
		state = 'hidden';
		showBtn.setText('Show');
		pre.hide();
		pre.setText('');
		errorEl.hide();
		card.removeClass('isb-secret-card--error');
	};

	const setShown = (text: string) => {
		state = 'shown';
		plaintext = text;
		pre.setText(text);
		pre.show();
		errorEl.hide();
		showBtn.setText('Hide');
		card.removeClass('isb-secret-card--error');
	};

	const setError = (message: string, allowRetry: boolean) => {
		state = 'error';
		plaintext = null;
		pre.hide();
		pre.setText('');
		errorEl.empty();
		errorEl.createSpan({
			cls: 'isb-secret-card__error-text',
			text: message,
		});
		if (allowRetry) {
			const retry = errorEl.createEl('button', {
				text: 'Try another passphrase',
				cls: 'isb-secret-card__btn',
			});
			retry.addEventListener('click', () => {
				void promptAndDecrypt().then((res) => {
					if (res !== null) setShown(res.plaintext);
				});
			});
		}
		errorEl.show();
		showBtn.setText('Show');
		card.addClass('isb-secret-card--error');
	};

	const noteIntendedKey = (id: string) => {
		currentKeyId = id;
		const path = mdCtx?.sourcePath;
		if (path) ctx.intendedKeys.set(path, id);
	};

	const reveal = async (): Promise<DecryptResult | null> => {
		try {
			const hit = await ctx.keystore.tryDecrypt(source);
			if (hit !== null) {
				noteIntendedKey(hit.id);
				return hit;
			}
		} catch (e) {
			if (e instanceof MalformedPayloadError) {
				setError(`This block is corrupted: ${e.message}`, false);
				return null;
			}
			setError(`Error: ${(e as Error).message}`, false);
			return null;
		}
		return promptAndDecrypt();
	};

	const promptAndDecrypt = (): Promise<DecryptResult | null> => {
		return new Promise((resolve) => {
			new PassphraseModal(ctx.app, {
				title: 'Enter passphrase',
				onSubmit: (passphrase) => {
					void tryWithPassphrase(passphrase).then(resolve);
				},
				onCancel: () => resolve(null),
			}).open();
		});
	};

	const tryWithPassphrase = async (
		passphrase: string,
	): Promise<DecryptResult | null> => {
		try {
			const text = await decrypt(source, passphrase);
			const entry = await ctx.keystore.add(passphrase);
			noteIntendedKey(entry.id);
			scheduleCascadeRerender(ctx);
			return { plaintext: text, id: entry.id };
		} catch (e) {
			if (e instanceof WrongPassphraseError) {
				setError('Wrong passphrase', true);
				return null;
			}
			if (e instanceof MalformedPayloadError) {
				setError(`This block is corrupted: ${e.message}`, false);
				return null;
			}
			setError(`Error: ${(e as Error).message}`, false);
			return null;
		}
	};

	showBtn.addEventListener('click', () => {
		if (state === 'shown') {
			setHidden();
			return;
		}
		void reveal().then((res) => {
			if (res !== null) setShown(res.plaintext);
		});
	});

	copyBtn.addEventListener('click', () => {
		void doCopy();
	});

	editBtn.addEventListener('click', () => {
		void doEdit();
	});

	const doCopy = async () => {
		let text = plaintext;
		if (text === null) {
			const res = await reveal();
			if (res === null) return;
			text = res.plaintext;
		}
		try {
			await navigator.clipboard.writeText(text);
			new Notice('Copied');
		} catch (e) {
			new Notice(`Could not copy: ${(e as Error).message}`);
		}
	};

	const doEdit = async (): Promise<void> => {
		let text = plaintext;
		if (text === null) {
			const res = await reveal();
			if (res === null) return;
			text = res.plaintext;
		}
		const plain = text;

		const sourcePath = mdCtx?.sourcePath;
		if (!sourcePath) {
			new Notice('Cannot resolve file context');
			return;
		}
		// Re-lock with the same key when auto-encrypt picks this block back up.
		if (currentKeyId !== null) {
			ctx.reEncryptKeys.set(sourcePath, currentKeyId);
		}
		const file = ctx.app.vault.getAbstractFileByPath(sourcePath);
		if (!(file instanceof TFile)) {
			new Notice('File not found');
			return;
		}

		const normalize = (s: string) => s.replace(/\s+/g, '');
		const sourceNorm = normalize(source);

		const active = ctx.app.workspace.getActiveViewOfType(MarkdownView);
		const useEditor =
			active !== null &&
			active.file?.path === sourcePath &&
			active.getMode() === 'source';

		if (useEditor) {
			const editor = active.editor;
			const docText = editor.getValue();
			const blocks = findBlocks(docText, 'secret-lock');
			const target = blocks.find(
				(b) => normalize(b.body) === sourceNorm,
			);
			if (!target) {
				new Notice('Block not found in editor');
				return;
			}
			editor.replaceRange(
				renderSecret(target.indent, target.fenceLen, plain, target.info),
				{ line: target.startLine, ch: 0 },
				{
					line: target.endLine,
					ch: editor.getLine(target.endLine).length,
				},
			);
			editor.setCursor({
				line: target.startLine + 1,
				ch: target.indent.length,
			});
			editor.focus();
		} else {
			const docText = await ctx.app.vault.read(file);
			const blocks = findBlocks(docText, 'secret-lock');
			const target = blocks.find(
				(b) => normalize(b.body) === sourceNorm,
			);
			if (!target) {
				new Notice('Block not found in file');
				return;
			}
			const newText = replaceBlocks(docText, [target], (b) =>
				renderSecret(b.indent, b.fenceLen, plain, b.info),
			);
			await ctx.app.vault.modify(file, newText);
		}
	};

	if (ctx.settings.autoShowSecrets) {
		void (async () => {
			try {
				const hit = await ctx.keystore.tryDecrypt(source);
				if (hit !== null) {
					noteIntendedKey(hit.id);
					setShown(hit.plaintext);
				}
			} catch (e) {
				if (e instanceof MalformedPayloadError) {
					setError(`This block is corrupted: ${e.message}`, false);
				}
			}
		})();
	}
}

function resolveLabel(
	el: HTMLElement,
	mdCtx?: MarkdownPostProcessorContext,
): string {
	const fallback = 'Secret (encrypted)';
	if (!mdCtx) return fallback;
	const section = mdCtx.getSectionInfo(el);
	if (!section) return fallback;
	const firstLine = section.text.split('\n')[section.lineStart];
	if (firstLine === undefined) return fallback;
	const info = parseInfoString(firstLine, 'secret-lock');
	return info.length > 0 ? info : fallback;
}

function scheduleCascadeRerender(ctx: RenderContext): void {
	if (!ctx.settings.autoShowSecrets) return;
	const view = ctx.app.workspace.getActiveViewOfType(MarkdownView);
	if (!view) return;
	const preview = view.previewMode;
	if (!preview || typeof preview.rerender !== 'function') return;
	window.setTimeout(() => {
		preview.rerender(true);
	}, 0);
}
