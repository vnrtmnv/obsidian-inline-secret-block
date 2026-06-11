import {
	decrypt,
	MalformedPayloadError,
	passphraseId,
	WrongPassphraseError,
} from './crypto';

export interface KeyEntry {
	id: string;
	label: string;
}

export interface DecryptHit {
	plaintext: string;
	id: string;
}

export class PassphraseCancelledError extends Error {
	constructor() {
		super('Passphrase prompt cancelled');
		this.name = 'PassphraseCancelledError';
	}
}

export class KeyStore {
	private readonly entries = new Map<string, string>();

	async add(passphrase: string): Promise<KeyEntry> {
		if (passphrase.length === 0) {
			throw new Error('Passphrase must not be empty');
		}
		const id = await passphraseId(passphrase);
		if (!this.entries.has(id)) {
			this.entries.set(id, passphrase);
		}
		return { id, label: formatLabel(passphrase, id) };
	}

	list(): KeyEntry[] {
		const out: KeyEntry[] = [];
		for (const [id, passphrase] of this.entries) {
			out.push({ id, label: formatLabel(passphrase, id) });
		}
		return out;
	}

	getPassphrase(id: string): string | null {
		return this.entries.get(id) ?? null;
	}

	async tryDecrypt(payload: string): Promise<DecryptHit | null> {
		for (const [id, passphrase] of this.entries) {
			try {
				const plaintext = await decrypt(payload, passphrase);
				return { plaintext, id };
			} catch (e) {
				if (e instanceof WrongPassphraseError) continue;
				throw e;
			}
		}
		return null;
	}

	clear(): void {
		this.entries.clear();
	}

	isEmpty(): boolean {
		return this.entries.size === 0;
	}
}

function formatLabel(passphrase: string, id: string): string {
	const first = passphrase[0] ?? '';
	const last = passphrase.length > 1 ? passphrase[passphrase.length - 1]! : first;
	const tail = id.slice(0, 6);
	return `${first}...${last} ${tail}`;
}

export { MalformedPayloadError };
