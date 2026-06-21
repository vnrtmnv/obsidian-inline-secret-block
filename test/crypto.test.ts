import { describe, it, expect, beforeEach } from 'vitest';
import {
	MalformedPayloadError,
	WrongPassphraseError,
	clearKeyCache,
	decrypt,
	encrypt,
	passphraseId,
	sha256Hex,
} from '../src/crypto';

const SALT_LEN = 16;
const IV_LEN = 12;
const TAG_LEN = 16;

function b64ToBytes(b64: string): Uint8Array {
	const bin = atob(b64);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

describe('crypto', () => {
	beforeEach(() => clearKeyCache());

	it('round-trips plaintext through encrypt/decrypt', async () => {
		const payload = await encrypt('hunter2', 'correct horse');
		expect(await decrypt(payload, 'correct horse')).toBe('hunter2');
	});

	it('round-trips unicode and multi-line content', async () => {
		const plain = 'логин: алиса\nпароль: пароль123 🔐';
		const payload = await encrypt(plain, 'pass');
		expect(await decrypt(payload, 'pass')).toBe(plain);
	});

	it('round-trips an empty string', async () => {
		const payload = await encrypt('', 'pass');
		expect(await decrypt(payload, 'pass')).toBe('');
	});

	it('produces a different payload each time (random salt + iv)', async () => {
		const a = await encrypt('same', 'pass');
		const b = await encrypt('same', 'pass');
		expect(a).not.toBe(b);
		expect(await decrypt(a, 'pass')).toBe('same');
		expect(await decrypt(b, 'pass')).toBe('same');
	});

	it('lays out the payload as salt(16) ‖ iv(12) ‖ ciphertext+tag', async () => {
		const payload = await encrypt('x', 'pass');
		const bytes = b64ToBytes(payload);
		// 1 plaintext byte + 16-byte GCM tag, plus salt + iv.
		expect(bytes.length).toBe(SALT_LEN + IV_LEN + 1 + TAG_LEN);
	});

	it('throws WrongPassphraseError on the wrong passphrase', async () => {
		const payload = await encrypt('secret', 'right');
		await expect(decrypt(payload, 'wrong')).rejects.toBeInstanceOf(
			WrongPassphraseError,
		);
	});

	it('throws WrongPassphraseError when the ciphertext is tampered with', async () => {
		const payload = await encrypt('secret', 'pass');
		const bytes = b64ToBytes(payload);
		bytes[bytes.length - 1] ^= 0xff; // flip a tag/ciphertext bit
		let tampered = '';
		for (const byte of bytes) tampered += String.fromCharCode(byte);
		await expect(decrypt(btoa(tampered), 'pass')).rejects.toBeInstanceOf(
			WrongPassphraseError,
		);
	});

	it('throws MalformedPayloadError on invalid base64', async () => {
		await expect(decrypt('not valid base64 !!!', 'pass')).rejects.toBeInstanceOf(
			MalformedPayloadError,
		);
	});

	it('throws MalformedPayloadError on a too-short payload', async () => {
		// Valid base64 but fewer than salt+iv+tag bytes.
		await expect(decrypt(btoa('short'), 'pass')).rejects.toBeInstanceOf(
			MalformedPayloadError,
		);
	});

	it('decrypts correctly with the key cache warm (same passphrase reused)', async () => {
		const payload = await encrypt('cached', 'pass');
		expect(await decrypt(payload, 'pass')).toBe('cached');
		// second decrypt hits the cached CryptoKey path
		expect(await decrypt(payload, 'pass')).toBe('cached');
	});

	it('sha256Hex / passphraseId are stable 64-hex-char digests', async () => {
		const id = await passphraseId('pass');
		expect(id).toMatch(/^[0-9a-f]{64}$/);
		expect(await sha256Hex('pass')).toBe(id);
		expect(await sha256Hex('other')).not.toBe(id);
	});
});
