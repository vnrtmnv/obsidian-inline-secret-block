import { App, Editor, MarkdownView, Notice, Plugin } from 'obsidian';
import {
	MalformedPayloadError,
	WrongPassphraseError,
	clearKeyCache,
	decrypt,
} from './crypto';
import { findBlocks, renderSecret, replaceBlocks } from './blocks';
import { KeyStore } from './keystore';
import { PassphraseModal } from './modal';

export interface CommandContext {
	app: App;
	plugin: Plugin;
	keystore: KeyStore;
	intendedKeys: Map<string, string>;
}

export function registerCommands(ctx: CommandContext): void {
	const { plugin } = ctx;

	plugin.addCommand({
		id: 'decrypt-current-note',
		name: 'Decrypt secret-lock blocks in current note',
		editorCallback: (editor) => {
			void runDecrypt(ctx, editor);
		},
	});

	plugin.addCommand({
		id: 'forget-passphrase',
		name: 'Forget all passphrases',
		callback: () => {
			ctx.keystore.clear();
			ctx.intendedKeys.clear();
			clearKeyCache();
			new Notice('All passphrases forgotten');
		},
	});
}

async function runDecrypt(ctx: CommandContext, editor: Editor): Promise<void> {
	const text = editor.getValue();
	const blocks = findBlocks(text, 'secret-lock');
	if (blocks.length === 0) {
		new Notice('No secret-lock blocks found');
		return;
	}

	const plaintexts: (string | null)[] = blocks.map(() => null);
	let pending = 0;
	let lastUsedId: string | null = null;

	for (let i = 0; i < blocks.length; i++) {
		try {
			const hit = await ctx.keystore.tryDecrypt(blocks[i]!.body);
			if (hit !== null) {
				plaintexts[i] = hit.plaintext;
				lastUsedId = hit.id;
			} else {
				pending++;
			}
		} catch (e) {
			if (e instanceof MalformedPayloadError) {
				new Notice(
					`Block at line ${blocks[i]!.startLine + 1} is corrupted: ${e.message}`,
				);
				return;
			}
			throw e;
		}
	}

	if (pending > 0) {
		const passphrase = await promptPassphrase(ctx.app);
		if (passphrase === null) return;

		for (let i = 0; i < blocks.length; i++) {
			if (plaintexts[i] !== null) continue;
			try {
				plaintexts[i] = await decrypt(blocks[i]!.body, passphrase);
			} catch (e) {
				if (e instanceof WrongPassphraseError) {
					new Notice('Wrong passphrase');
					return;
				}
				if (e instanceof MalformedPayloadError) {
					new Notice(
						`Block at line ${blocks[i]!.startLine + 1} is corrupted: ${e.message}`,
					);
					return;
				}
				throw e;
			}
		}
		const entry = await ctx.keystore.add(passphrase);
		lastUsedId = entry.id;
	}

	if (lastUsedId !== null) {
		const path = ctx.app.workspace.getActiveViewOfType(MarkdownView)?.file
			?.path;
		if (path) ctx.intendedKeys.set(path, lastUsedId);
	}

	let idx = 0;
	const newText = replaceBlocks(text, blocks, (b) =>
		renderSecret(b.indent, b.fenceLen, plaintexts[idx++]!, b.info),
	);
	editor.setValue(newText);
	new Notice(`Decrypted ${blocks.length} block(s)`);
}

function promptPassphrase(app: App): Promise<string | null> {
	return new Promise((resolve) => {
		new PassphraseModal(app, {
			title: 'Enter passphrase',
			onSubmit: (v) => resolve(v),
			onCancel: () => resolve(null),
		}).open();
	});
}
