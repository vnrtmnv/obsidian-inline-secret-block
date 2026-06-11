import { App, PluginSettingTab, Setting } from 'obsidian';
import type InlineSecretBlockPlugin from './main';

export interface ISBSettings {
	autoShowSecrets: boolean;
}

export const DEFAULT_SETTINGS: ISBSettings = {
	autoShowSecrets: false,
};

export class ISBSettingTab extends PluginSettingTab {
	private readonly plugin: InlineSecretBlockPlugin;

	constructor(app: App, plugin: InlineSecretBlockPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName('Always show secret preview')
			.setDesc(
				'When a matching key is available in this session, reveal secret-lock blocks automatically without clicking show.',
			)
			.addToggle((t) =>
				t
					.setValue(this.plugin.settings.autoShowSecrets)
					.onChange(async (value) => {
						this.plugin.settings.autoShowSecrets = value;
						await this.plugin.saveSettings();
					}),
			);
	}
}
