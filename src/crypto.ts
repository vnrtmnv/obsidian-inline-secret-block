const PBKDF2_ITERS = 250_000;
const SALT_LEN = 16;
const IV_LEN = 12;
const KEY_LEN = 256;
const TAG_LEN_BYTES = 16;
const HASH = 'SHA-256';

const subtle = crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();

const keyCache = new Map<string, CryptoKey>();

export class WrongPassphraseError extends Error {
	constructor() {
		super('Wrong passphrase');
		this.name = 'WrongPassphraseError';
	}
}

export class MalformedPayloadError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'MalformedPayloadError';
	}
}

export async function encrypt(
	plaintext: string,
	passphrase: string,
): Promise<string> {
	const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
	const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
	const key = await deriveKey(passphrase, salt);
	const data = encodeUtf8(plaintext);
	const ciphertext = new Uint8Array(
		await subtle.encrypt({ name: 'AES-GCM', iv }, key, data),
	);

	const payload = new Uint8Array(salt.length + iv.length + ciphertext.length);
	payload.set(salt, 0);
	payload.set(iv, salt.length);
	payload.set(ciphertext, salt.length + iv.length);
	return toBase64(payload);
}

export async function decrypt(
	payloadB64: string,
	passphrase: string,
): Promise<string> {
	let payload: Uint8Array;
	try {
		payload = fromBase64(payloadB64);
	} catch {
		throw new MalformedPayloadError('Invalid base64 payload');
	}

	if (payload.length < SALT_LEN + IV_LEN + TAG_LEN_BYTES) {
		throw new MalformedPayloadError('Payload too short');
	}

	const salt = payload.slice(0, SALT_LEN);
	const iv = payload.slice(SALT_LEN, SALT_LEN + IV_LEN);
	const ciphertext = payload.slice(SALT_LEN + IV_LEN);

	const key = await deriveKey(passphrase, salt);

	try {
		const plain = await subtle.decrypt(
			{ name: 'AES-GCM', iv },
			key,
			ciphertext,
		);
		return dec.decode(plain);
	} catch {
		throw new WrongPassphraseError();
	}
}

export function clearKeyCache(): void {
	keyCache.clear();
}

export async function sha256Hex(input: string): Promise<string> {
	const bytes = new Uint8Array(await subtle.digest(HASH, encodeUtf8(input)));
	return toHex(bytes);
}

export const passphraseId = sha256Hex;

async function deriveKey(
	passphrase: string,
	salt: Uint8Array,
): Promise<CryptoKey> {
	const fp = await sha256Hex(passphrase);
	const cacheKey = fp + ':' + toHex(salt);
	const cached = keyCache.get(cacheKey);
	if (cached) return cached;

	const passBytes = encodeUtf8(passphrase);
	const baseKey = await subtle.importKey(
		'raw',
		passBytes,
		{ name: 'PBKDF2' },
		false,
		['deriveKey'],
	);

	const key = await subtle.deriveKey(
		{
			name: 'PBKDF2',
			hash: HASH,
			salt: new Uint8Array(salt),
			iterations: PBKDF2_ITERS,
		},
		baseKey,
		{ name: 'AES-GCM', length: KEY_LEN },
		false,
		['encrypt', 'decrypt'],
	);

	keyCache.set(cacheKey, key);
	return key;
}

function encodeUtf8(s: string) {
	return new Uint8Array(enc.encode(s));
}

function toHex(bytes: Uint8Array): string {
	let s = '';
	for (let i = 0; i < bytes.length; i++) {
		s += bytes[i]!.toString(16).padStart(2, '0');
	}
	return s;
}

function toBase64(bytes: Uint8Array): string {
	let s = '';
	for (let i = 0; i < bytes.length; i++) {
		s += String.fromCharCode(bytes[i]!);
	}
	return btoa(s);
}

function fromBase64(s: string): Uint8Array {
	const cleaned = s.replace(/\s+/g, '');
	if (cleaned.length === 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(cleaned)) {
		throw new Error('Invalid base64');
	}
	const bin = atob(cleaned);
	const bytes = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) {
		bytes[i] = bin.charCodeAt(i);
	}
	return bytes;
}
