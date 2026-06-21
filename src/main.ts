import { MarkdownView, Plugin } from 'obsidian';
import { setupAutoEncrypt } from './autoencrypt';
import { registerCommands } from './commands';
import { clearKeyCache } from './crypto';
import { makeInlineLivePreviewExtension } from './inlineLivePreview';
import { buildInlineSecretChip } from './inlineRender';
import { KeyStore } from './keystore';
import { renderSecretLockBlock } from './render';
import { DEFAULT_SETTINGS, ISBSettings, ISBSettingTab } from './settings';

export default class InlineSecretBlockPlugin extends Plugin {
	settings!: ISBSettings;
	private keystore!: KeyStore;
	private readonly intendedKeys = new Map<string, string>();

	async onload() {
		await this.loadSettings();
		this.keystore = new KeyStore();

		this.registerMarkdownCodeBlockProcessor(
			'secret-lock',
			(source, el, mdCtx) => {
				renderSecretLockBlock(
					{
						app: this.app,
						keystore: this.keystore,
						settings: this.settings,
						intendedKeys: this.intendedKeys,
					},
					source,
					el,
					mdCtx,
				);
			},
		);

		this.registerMarkdownPostProcessor((el, mdCtx) => {
			el.querySelectorAll('code').forEach((code) => {
				if (code.closest('pre')) return;
				const raw = code.textContent ?? '';
				if (!raw.startsWith('secret-lock ')) return;
				const payload = raw.slice('secret-lock '.length);
				const chip = buildInlineSecretChip(
					{
						app: this.app,
						keystore: this.keystore,
						intendedKeys: this.intendedKeys,
						resolveSourcePath: () => mdCtx.sourcePath,
					},
					payload,
				);
				code.replaceWith(chip);
			});
		});

		this.registerEditorExtension(
			makeInlineLivePreviewExtension({
				app: this.app,
				keystore: this.keystore,
				intendedKeys: this.intendedKeys,
				resolveSourcePath: () =>
					this.app.workspace.getActiveViewOfType(MarkdownView)?.file
						?.path,
			}),
		);

		setupAutoEncrypt({
			app: this.app,
			plugin: this,
			keystore: this.keystore,
			intendedKeys: this.intendedKeys,
		});

		registerCommands({
			app: this.app,
			plugin: this,
			keystore: this.keystore,
			intendedKeys: this.intendedKeys,
		});

		this.addSettingTab(new ISBSettingTab(this.app, this));
	}

	onunload() {
		this.keystore?.clear();
		this.intendedKeys.clear();
		clearKeyCache();
	}

	async loadSettings() {
		const raw = (await this.loadData()) as Partial<ISBSettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, raw ?? {});
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
