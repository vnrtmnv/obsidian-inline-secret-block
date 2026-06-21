import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		// Node environment: the pure modules under test (crypto/blocks/inline/
		// keystore) need no DOM. Web Crypto (crypto.subtle, getRandomValues),
		// btoa/atob and TextEncoder are all global in Node 20+.
		environment: 'node',
		globals: true,
		include: ['test/**/*.test.ts'],
	},
});
