import { Plugin } from 'obsidian';
import { setupAutoEncrypt } from './autoencrypt';
import { registerCommands } from './commands';
import { clearKeyCache } from './crypto';
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
