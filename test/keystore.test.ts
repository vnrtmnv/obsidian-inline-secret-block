import { describe, it, expect, beforeEach } from 'vitest';
import { clearKeyCache, encrypt, passphraseId } from '../src/crypto';
import { KeyStore, MalformedPayloadError } from '../src/keystore';

describe('KeyStore', () => {
	beforeEach(() => clearKeyCache());

	it('add returns id = sha256(passphrase) and a redacted label', async () => {
		const store = new KeyStore();
		const entry = await store.add('abc');
		expect(entry.id).toBe(await passphraseId('abc'));
		expect(entry.label).toBe(`a...c ${entry.id.slice(0, 6)}`);
	});

	it('add rejects an empty passphrase', async () => {
		const store = new KeyStore();
		await expect(store.add('')).rejects.toThrow();
	});

	it('deduplicates the same passphrase', async () => {
		const store = new KeyStore();
		await store.add('pass');
		await store.add('pass');
		expect(store.list()).toHaveLength(1);
	});

	it('getPassphrase returns the stored value or null', async () => {
		const store = new KeyStore();
		const entry = await store.add('pass');
		expect(store.getPassphrase(entry.id)).toBe('pass');
		expect(store.getPassphrase('nope')).toBeNull();
	});

	it('tryDecrypt returns the first matching key', async () => {
		const store = new KeyStore();
		await store.add('alpha');
		const beta = await store.add('beta');
		const payload = await encrypt('top secret', 'beta');
		const hit = await store.tryDecrypt(payload);
		expect(hit).not.toBeNull();
		expect(hit?.plaintext).toBe('top secret');
		expect(hit?.id).toBe(beta.id);
	});

	it('tryDecrypt returns null when no key matches', async () => {
		const store = new KeyStore();
		await store.add('alpha');
		const payload = await encrypt('x', 'not-in-store');
		expect(await store.tryDecrypt(payload)).toBeNull();
	});

	it('tryDecrypt propagates a malformed-payload error', async () => {
		const store = new KeyStore();
		await store.add('alpha');
		await expect(store.tryDecrypt('!!!not base64')).rejects.toBeInstanceOf(
			MalformedPayloadError,
		);
	});

	it('clear empties the store', async () => {
		const store = new KeyStore();
		await store.add('pass');
		expect(store.isEmpty()).toBe(false);
		store.clear();
		expect(store.isEmpty()).toBe(true);
		expect(store.list()).toHaveLength(0);
	});
});
