import { App, Modal, Setting } from 'obsidian';
import { KeyEntry } from './keystore';

export interface PassphraseModalOptions {
	title?: string;
	onSubmit: (passphrase: string) => void;
	onCancel?: () => void;
}

export class PassphraseModal extends Modal {
	private readonly title: string;
	private readonly onSubmit: (passphrase: string) => void;
	private readonly onCancel?: () => void;

	private input?: HTMLInputElement;
	private submitBtn?: HTMLButtonElement;
	private submitted = false;

	constructor(app: App, options: PassphraseModalOptions) {
		super(app);
		this.title = options.title ?? 'Enter passphrase';
		this.onSubmit = options.onSubmit;
		this.onCancel = options.onCancel;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', { text: this.title });

		new Setting(contentEl).setName('Passphrase').addText((t) => {
			t.inputEl.type = 'password';
			t.inputEl.autocomplete = 'new-password';
			this.input = t.inputEl;
			t.onChange(() => this.refresh());
		});

		const buttonRow = contentEl.createDiv({ cls: 'isb-modal-buttons' });
		this.submitBtn = buttonRow.createEl('button', {
			text: 'Submit',
			cls: 'mod-cta',
		});
		this.submitBtn.addEventListener('click', () => this.submit());

		const cancelBtn = buttonRow.createEl('button', { text: 'Cancel' });
		cancelBtn.addEventListener('click', () => this.close());

		this.input?.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				this.submit();
			} else if (e.key === 'Escape') {
				e.preventDefault();
				this.close();
			}
		});

		this.refresh();
		this.input?.focus();
	}

	onClose() {
		if (this.input) this.input.value = '';
		this.contentEl.empty();
		if (!this.submitted) {
			this.onCancel?.();
		}
	}

	private refresh() {
		if (!this.submitBtn) return;
		const v = this.input?.value ?? '';
		this.submitBtn.disabled = v.length === 0;
	}

	private submit() {
		if (this.submitted) return;
		if (this.submitBtn?.disabled) return;
		const value = this.input?.value ?? '';
		if (value.length === 0) return;
		this.submitted = true;
		this.onSubmit(value);
		this.close();
	}
}

export type KeyChoice =
	| { kind: 'existing'; id: string }
	| { kind: 'new'; passphrase: string };

export interface KeyChoiceModalOptions {
	keys: KeyEntry[];
	preferredId?: string;
	onChoose: (choice: KeyChoice) => void;
	onCancel?: () => void;
}

export class KeyChoiceModal extends Modal {
	private readonly keys: KeyEntry[];
	private readonly preferredId?: string;
	private readonly onChoose: (choice: KeyChoice) => void;
	private readonly onCancel?: () => void;

	private input?: HTMLInputElement;
	private submitBtn?: HTMLButtonElement;
	private resolved = false;

	constructor(app: App, options: KeyChoiceModalOptions) {
		super(app);
		this.keys = options.keys;
		this.preferredId = options.preferredId;
		this.onChoose = options.onChoose;
		this.onCancel = options.onCancel;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', { text: 'Encrypt with key' });

		let focusBtn: HTMLButtonElement | undefined;
		if (this.keys.length > 0) {
			contentEl.createDiv({
				cls: 'isb-key-section-title',
				text: 'Existing keys',
			});
			const list = contentEl.createDiv({ cls: 'isb-key-list' });
			for (const k of this.keys) {
				const btn = list.createEl('button', {
					cls: 'isb-key-button',
					text: k.label,
				});
				if (!focusBtn || k.id === this.preferredId) focusBtn = btn;
				btn.addEventListener('click', () => {
					if (this.resolved) return;
					this.resolved = true;
					this.onChoose({ kind: 'existing', id: k.id });
					this.close();
				});
			}
			contentEl.createDiv({
				cls: 'isb-key-section-title',
				text: 'Or new passphrase',
			});
		} else {
			contentEl.createEl('p', {
				cls: 'isb-modal-hint',
				text: 'No keys yet. Enter a passphrase to encrypt this block.',
			});
		}

		new Setting(contentEl).setName('Passphrase').addText((t) => {
			t.inputEl.type = 'password';
			t.inputEl.autocomplete = 'new-password';
			this.input = t.inputEl;
			t.onChange(() => this.refresh());
		});

		const buttonRow = contentEl.createDiv({ cls: 'isb-modal-buttons' });
		this.submitBtn = buttonRow.createEl('button', {
			text: 'Submit',
			cls: 'mod-cta',
		});
		this.submitBtn.addEventListener('click', () => this.submitNew());

		const cancelBtn = buttonRow.createEl('button', { text: 'Cancel' });
		cancelBtn.addEventListener('click', () => this.close());

		this.input?.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				this.submitNew();
			} else if (e.key === 'Escape') {
				e.preventDefault();
				this.close();
			}
		});

		this.refresh();
		if (focusBtn) focusBtn.focus();
		else this.input?.focus();
	}

	onClose() {
		if (this.input) this.input.value = '';
		this.contentEl.empty();
		if (!this.resolved) {
			this.onCancel?.();
		}
	}

	private refresh() {
		if (!this.submitBtn) return;
		const v = this.input?.value ?? '';
		this.submitBtn.disabled = v.length === 0;
	}

	private submitNew() {
		if (this.resolved) return;
		const value = this.input?.value ?? '';
		if (value.length === 0) return;
		this.resolved = true;
		this.onChoose({ kind: 'new', passphrase: value });
		this.close();
	}
}
