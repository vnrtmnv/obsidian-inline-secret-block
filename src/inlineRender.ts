import { App, MarkdownView, Notice, TFile, setIcon } from 'obsidian';
import { MalformedPayloadError, WrongPassphraseError, decrypt } from './crypto';
import { findInlineSecrets, renderInlinePlain } from './inline';
import { KeyStore } from './keystore';
import { PassphraseModal } from './modal';

export interface InlineRenderContext {
	app: App;
	keystore: KeyStore;
	intendedKeys: Map<string, string>;
	reEncryptKeys: Map<string, string>;
	resolveSourcePath?: () => string | undefined;
}

const PLACEHOLDER = '••••';
const INLINE_PREFIX = '`secret ';

/**
 * Compact inline chip for a `secret-lock` span. Clicking the chip copies the
 * plaintext to the clipboard; the edit icon decrypts it back to a plain
 * `secret` span so it can be edited (auto-encrypt re-locks it with the same
 * key, no prompt). Used by both the reading-view post-processor and the Live
 * Preview widget.
 */
export function buildInlineSecretChip(
	ctx: InlineRenderContext,
	payload: string,
): HTMLElement {
	const chip = createSpan({ cls: 'isb-inline-secret' });

	const iconEl = chip.createSpan({ cls: 'isb-inline-secret__icon' });
	setIcon(iconEl, 'lock');

	chip.createSpan({
		cls: 'isb-inline-secret__value',
		text: PLACEHOLDER,
	});

	const editBtn = chip.createSpan({ cls: 'isb-inline-secret__edit' });
	setIcon(editBtn, 'pencil');
	editBtn.setAttribute('role', 'button');
	editBtn.setAttribute('aria-label', 'Edit secret');

	let plaintext: string | null = null;
	let currentKeyId: string | null = null;

	const noteKey = (id: string): void => {
		currentKeyId = id;
		const path = ctx.resolveSourcePath?.();
		if (path) ctx.intendedKeys.set(path, id);
	};

	const showError = (e: unknown): void => {
		chip.addClass('isb-inline-secret--error');
		const valueEl = chip.querySelector<HTMLElement>(
			'.isb-inline-secret__value',
		);
		valueEl?.setText(
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

	chip.addEventListener('click', (ev) => {
		if (editBtn.contains(ev.target as Node)) return;
		void (async () => {
			const text = await ensurePlaintext();
			if (text === null) return;
			try {
				await navigator.clipboard.writeText(text);
				new Notice('Copied');
			} catch (e) {
				new Notice(`Could not copy: ${(e as Error).message}`);
			}
		})();
	});

	editBtn.addEventListener('click', (ev) => {
		ev.stopPropagation();
		void doEdit();
	});

	return chip;
}
