import { App, Notice, setIcon } from 'obsidian';
import { MalformedPayloadError, WrongPassphraseError, decrypt } from './crypto';
import { KeyStore } from './keystore';
import { PassphraseModal } from './modal';

export interface InlineRenderContext {
	app: App;
	keystore: KeyStore;
	intendedKeys: Map<string, string>;
	resolveSourcePath?: () => string | undefined;
}

const PLACEHOLDER = '••••';

/**
 * Compact inline chip for a `secret-lock` span. Click toggles reveal/hide of
 * the value in place; the copy icon copies the plaintext without revealing it.
 * Used by both the reading-view post-processor and the Live Preview widget.
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

	const copyBtn = chip.createSpan({ cls: 'isb-inline-secret__copy' });
	setIcon(copyBtn, 'copy');
	copyBtn.setAttribute('role', 'button');
	copyBtn.setAttribute('aria-label', 'Copy secret');

	let plaintext: string | null = null;
	let shown = false;

	const noteIntendedKey = (id: string): void => {
		const path = ctx.resolveSourcePath?.();
		if (path) ctx.intendedKeys.set(path, id);
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
			noteIntendedKey(entry.id);
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
				noteIntendedKey(hit.id);
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

	chip.addEventListener('click', (ev) => {
		if (copyBtn.contains(ev.target as Node)) return;
		if (shown) {
			shown = false;
			valueEl.setText(PLACEHOLDER);
			return;
		}
		void ensurePlaintext().then((text) => {
			if (text === null) return;
			shown = true;
			valueEl.setText(text);
		});
	});

	copyBtn.addEventListener('click', (ev) => {
		ev.stopPropagation();
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

	return chip;
}
