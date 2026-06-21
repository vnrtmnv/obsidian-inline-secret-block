import { App, MarkdownView, Notice, TFile, setIcon } from 'obsidian';
import { MalformedPayloadError, WrongPassphraseError, decrypt } from './crypto';
import { findInlineSecrets, renderInlinePlain } from './inline';
import { KeyStore } from './keystore';
import { PassphraseModal } from './modal';
import { ISBSettings } from './settings';

export interface InlineRenderContext {
	app: App;
	keystore: KeyStore;
	settings: ISBSettings;
	intendedKeys: Map<string, string>;
	reEncryptKeys: Map<string, string>;
	resolveSourcePath?: () => string | undefined;
}

const PLACEHOLDER = '••••';
const INLINE_PREFIX = '`secret ';

/**
 * Compact inline chip for a `secret-lock` span. Buttons: show (reveal/hide the
 * value in place), copy (clipboard, never shown on screen), edit (decrypt back
 * to a plain `secret` span; auto-encrypt re-locks it with the same key, no
 * prompt). Clicking the chip body copies too. Honors `autoShowSecrets`.
 * Reused by the reading-view post-processor and the Live Preview widget.
 */
export function buildInlineSecretChip(
	ctx: InlineRenderContext,
	payload: string,
): HTMLElement {
	const chip = createSpan({ cls: 'isb-inline-secret' });

	const iconEl = chip.createSpan({ cls: 'isb-inline-secret__icon' });
	setIcon(iconEl, 'lock');

	const valueEl = chip.createSpan({
		cls: 'isb-inline-secret__value',
		text: PLACEHOLDER,
	});

	const showBtn = chip.createSpan({ cls: 'isb-inline-secret__btn' });
	setIcon(showBtn, 'eye');
	showBtn.setAttribute('role', 'button');
	showBtn.setAttribute('aria-label', 'Show secret');

	const copyBtn = chip.createSpan({ cls: 'isb-inline-secret__btn' });
	setIcon(copyBtn, 'copy');
	copyBtn.setAttribute('role', 'button');
	copyBtn.setAttribute('aria-label', 'Copy secret');

	const editBtn = chip.createSpan({ cls: 'isb-inline-secret__btn' });
	setIcon(editBtn, 'pencil');
	editBtn.setAttribute('role', 'button');
	editBtn.setAttribute('aria-label', 'Edit secret');

	let plaintext: string | null = null;
	let currentKeyId: string | null = null;
	let shown = false;

	const noteKey = (id: string): void => {
		currentKeyId = id;
		const path = ctx.resolveSourcePath?.();
		if (path) ctx.intendedKeys.set(path, id);
	};

	const setShown = (text: string): void => {
		shown = true;
		valueEl.setText(text);
		setIcon(showBtn, 'eye-off');
		showBtn.setAttribute('aria-label', 'Hide secret');
	};

	const setHidden = (): void => {
		shown = false;
		valueEl.setText(PLACEHOLDER);
		setIcon(showBtn, 'eye');
		showBtn.setAttribute('aria-label', 'Show secret');
	};

	const showError = (e: unknown): void => {
		chip.addClass('isb-inline-secret--error');
		valueEl.setText(
			e instanceof MalformedPayloadError ? 'corrupted' : 'error',
		);
	};

	const tryWithPassphrase = async (
		passphrase: string,
	): Promise<string | null> => {
		try {
			const text = await decrypt(payload, passphrase);
			const entry = await ctx.keystore.add(passphrase);
			noteKey(entry.id);
			plaintext = text;
			return text;
		} catch (e) {
			if (e instanceof WrongPassphraseError) {
				new Notice('Wrong passphrase');
				return null;
			}
			showError(e);
			return null;
		}
	};

	const ensurePlaintext = async (): Promise<string | null> => {
		if (plaintext !== null) return plaintext;
		try {
			const hit = await ctx.keystore.tryDecrypt(payload);
			if (hit !== null) {
				plaintext = hit.plaintext;
				noteKey(hit.id);
				return plaintext;
			}
		} catch (e) {
			showError(e);
			return null;
		}
		return new Promise<string | null>((resolve) => {
			new PassphraseModal(ctx.app, {
				title: 'Enter passphrase',
				onSubmit: (passphrase) => {
					void tryWithPassphrase(passphrase).then(resolve);
				},
				onCancel: () => resolve(null),
			}).open();
		});
	};

	const doCopy = async (): Promise<void> => {
		const text = await ensurePlaintext();
		if (text === null) return;
		try {
			await navigator.clipboard.writeText(text);
			new Notice('Copied');
		} catch (e) {
			new Notice(`Could not copy: ${(e as Error).message}`);
		}
	};

	const doEdit = async (): Promise<void> => {
		const text = await ensurePlaintext();
		if (text === null) return;

		const path = ctx.resolveSourcePath?.();
		if (!path) {
			new Notice('Cannot resolve file context');
			return;
		}
		// Re-lock with the same key when auto-encrypt picks this span back up.
		if (currentKeyId !== null) ctx.reEncryptKeys.set(path, currentKeyId);

		const active = ctx.app.workspace.getActiveViewOfType(MarkdownView);
		const useEditor =
			active !== null &&
			active.file?.path === path &&
			active.getMode() === 'source';

		if (useEditor) {
			const editor = active.editor;
			const match = findInlineSecrets(editor.getValue(), 'secret-lock').find(
				(s) => s.body === payload,
			);
			if (!match) {
				new Notice('Inline secret not found in editor');
				return;
			}
			editor.replaceRange(
				renderInlinePlain(text),
				{ line: match.line, ch: match.chStart },
				{ line: match.line, ch: match.chEnd },
			);
			editor.setCursor({
				line: match.line,
				ch: match.chStart + INLINE_PREFIX.length + text.length,
			});
			editor.focus();
			return;
		}

		const file = ctx.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			new Notice('File not found');
			return;
		}
		const docText = await ctx.app.vault.read(file);
		const lines = docText.split('\n');
		const match = findInlineSecrets(docText, 'secret-lock').find(
			(s) => s.body === payload,
		);
		if (!match) {
			new Notice('Inline secret not found in file');
			return;
		}
		const line = lines[match.line]!;
		lines[match.line] =
			line.slice(0, match.chStart) +
			renderInlinePlain(text) +
			line.slice(match.chEnd);
		await ctx.app.vault.modify(file, lines.join('\n'));
	};

	// In Live Preview the chip is a CM widget; a mousedown would move the
	// editor cursor into the span, drop the decoration, and expose the raw
	// `secret-lock …` text. Prevent that so reveal/copy/edit act on the chip.
	chip.addEventListener('mousedown', (ev) => ev.preventDefault());

	showBtn.addEventListener('click', (ev) => {
		ev.stopPropagation();
		if (shown) {
			setHidden();
			return;
		}
		void ensurePlaintext().then((text) => {
			if (text !== null) setShown(text);
		});
	});

	copyBtn.addEventListener('click', (ev) => {
		ev.stopPropagation();
		void doCopy();
	});

	editBtn.addEventListener('click', (ev) => {
		ev.stopPropagation();
		void doEdit();
	});

	chip.addEventListener('click', () => {
		void doCopy();
	});

	if (ctx.settings.autoShowSecrets) {
		void (async () => {
			try {
				const hit = await ctx.keystore.tryDecrypt(payload);
				if (hit !== null) {
					plaintext = hit.plaintext;
					noteKey(hit.id);
					setShown(hit.plaintext);
				}
			} catch (e) {
				if (e instanceof MalformedPayloadError) showError(e);
			}
		})();
	}

	return chip;
}
