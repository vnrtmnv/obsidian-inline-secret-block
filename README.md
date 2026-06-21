# Inline Secret Block

An Obsidian plugin that encrypts secrets inside your notes using AES-256-GCM
and a passphrase — both **fenced code blocks** (multi-line) and **single-line
inline code spans**. Useful when your vault is read by sync services, backup
tools, or AI agents and you do not want passwords, tokens, or other secrets
sitting in plaintext.

You write a `secret` block (or a `` `secret …` `` inline span), the plugin asks
for a passphrase as soon as you move away from it, and rewrites it as a
`secret-lock` form whose body is opaque ciphertext. In reading view and Live
Preview the encrypted secret renders as something you can reveal or copy in
place. Multiple passphrases can be in use at the same time — the plugin
remembers each one you have entered in the current session and always lets you
choose which key to use for a new secret.

## How it works

You wrap the sensitive content in a fenced block with the language `secret`:

````md
The login for service X:

```secret
login: alice
pass: hunter2
token: gh_xxxxxxxxxxxxxxxxxx
```
````

The moment the closing fence is in place, a modal opens. If you have not used
any passphrase yet, it just asks for one. If you have already used some in
this session, it lists them (labelled like `a...2 9f1c0b` — first character,
last character, and the first 6 hex characters of the passphrase hash) so you
can pick an existing key, or enter a new one. Pressing **Submit** replaces
the block with:

````md
The login for service X:

```secret-lock
QmFzZTY0ZW5jb2RlZHBheWxvYWQuLi4=
```
````

Pressing **Cancel** (or **Esc**) leaves the block as plaintext. If you change
the body afterwards, the prompt comes back; if you do not touch it, the
plugin will not nag you again about that exact block.

In **reading view**, each `secret-lock` block becomes a card with a lock icon
and **Show** / **Edit** / **Copy** buttons. Press **Show** to decrypt and
reveal the content; press **Hide** to clear it from the DOM again. **Copy**
sends the plaintext to the clipboard without revealing it on screen.
**Edit** decrypts the block back to a plain `secret` block right in the
file so you can change it, and auto-encrypt picks it up again as soon as
you click outside or stop typing. The plugin tries every passphrase it has
in memory automatically — you only see the password modal if none of them
fit.

When you already have keys in memory, the chooser is shown every time you
encrypt a new secret, so you stay in control of which key it uses. The last
key you used in the current file is listed first and pre-focused, so reusing
it is a single click (just press **Enter**), while picking a different key or
typing a brand-new passphrase is always one step away.

## Single-line (inline) secrets

For short secrets you do not need a whole fenced block. Wrap the value in an
inline code span prefixed with `secret `:

```md
password: `secret hunter2`
```

As soon as you move the cursor off that span, the plugin prompts for a key and
rewrites it as:

```md
password: `secret-lock QmFzZTY0Li4u`
```

In both Live Preview and reading view the `secret-lock` span renders as a
compact chip with a lock icon:

- **Click the chip** to reveal the value inline; click again to hide it.
- **Click the copy icon** to copy the plaintext to the clipboard without
  revealing it on screen.

Inline secrets deliberately have **no custom label/alias** (unlike fenced
blocks) to keep them simple. In Live Preview, move the cursor into the chip to
edit the raw `secret-lock` text.

If you need to convert many secrets in one go (e.g. before bulk-editing a
note), run **Decrypt secret-lock blocks in current note** to revert all
`secret-lock` blocks **and** inline spans in the active note back to `secret`.

## Commands

| Command                                       | What it does                                                                                                                       |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Decrypt secret-lock blocks in current note**| Decrypts every `` ```secret-lock `` block and `` `secret-lock …` `` inline span back to `secret` so you can edit it. Tries every key in memory; if none fits, prompts. |
| **Forget all passphrases**                    | Clears every passphrase and derived-key from memory. The next operation will prompt again.                                         |

Wrong passphrase on the decrypt command is a no-op: the file is not changed
and you get a notice. Same for corrupted blocks.

In a reading-view card, a wrong passphrase shows an inline error and a **Try
another passphrase** button — use it when the block was encrypted with a key
the plugin does not have in memory yet.

## Settings

The plugin has a single setting under **Settings → Community plugins →
Inline Secret Block**:

- **Always show secret preview** — when enabled, every `secret-lock` block
  whose key is already in memory reveals automatically in reading view,
  without you having to press **Show**. Blocks whose key is *not* in memory
  stay hidden behind the lock card as usual. Off by default.

## Cryptography

- **AES-256-GCM** for confidentiality and integrity. A wrong passphrase or
  any tampering with the ciphertext is detected by GCM's authentication tag.
- **PBKDF2-SHA-256, 250 000 iterations** to derive the key from your
  passphrase.
- Per-block random **16-byte salt** and **12-byte IV**. Both are prepended to
  the ciphertext and the whole `salt ‖ iv ‖ ciphertext+tag` blob is
  base64-encoded — that is what you see between the fences.
- All primitives come from the platform Web Crypto API (`crypto.subtle`). No
  third-party crypto dependencies.
- Derived keys are cached in memory keyed by `(passphrase fingerprint, salt)`
  so opening a note with many blocks does not re-run PBKDF2 each time.

## Threat model

What the plugin **does** protect:

- **The content of the secret in the file on disk.** Whoever reads the
  `.md` file — sync provider, cloud backup, AI agent that crawls the vault,
  another Obsidian plugin — sees ciphertext, not your password.

What the plugin **does not** protect, and these are real:

- **Plaintext residues after in-place encryption.** Once you have typed the
  secret into a `secret` block, the plaintext may already exist in:
  - the editor's undo history (cleared when you reload the file),
  - Obsidian's File Recovery snapshots,
  - your sync provider's version history,
  - filesystem-level backups (Time Machine, restic, etc.).

  **Recommendation: enter the secret in a `secret` block and run encrypt
  before the first sync of the file.** If the file has already been synced
  with plaintext, assume the plaintext is out there forever and rotate the
  affected credential.

- **Plaintext on screen.** Once you press **Show** (or **Copy**), the secret
  is in the DOM and the clipboard. Anything that can read your DOM (other
  plugins, screen readers, accessibility tools, screenshots) can read it.

- **No passphrase recovery.** Forget the passphrase, lose the data. There is
  no escrow, no hint, no recovery email.

- **The cryptography has not been independently audited.** The primitives
  are standard and used as documented, but you should treat this as a
  best-effort tool, not a vetted security product. If your threat model
  requires audited crypto, use a dedicated password manager.

- **The key picker leaks the first and last character of each passphrase.**
  The label shown next to each in-memory key is `<first>...<last> <hash6>`,
  so an attacker who briefly sees the picker learns two characters and
  ~24 bits of the hash. This is an intentional UX trade-off so you can tell
  keys apart at a glance; it makes short or low-entropy passphrases noticeably
  easier to brute-force. Use long, high-entropy passphrases.

Passphrases are held in memory for the duration of your Obsidian session
(or until you run **Forget all passphrases**). They are never written to disk
and never sent over the network. The plugin does not write any persistent
state at all.

## Installation

### Manual install

1. Download `main.js`, `manifest.json`, and `styles.css` from the latest
   GitHub release.
2. Copy them into `<Vault>/.obsidian/plugins/inline-secret-block/` (create
   the folder).
3. In Obsidian, open **Settings → Community plugins**, reload the plugin
   list, and enable **Inline Secret Block**.

### Build from source

```bash
git clone https://github.com/vnrtmnv/obsidian-inline-secret-block
cd obsidian-inline-secret-block
npm install
npm run build
```

`main.js` is produced at the repository root. Copy it together with
`manifest.json` and `styles.css` as above.

### One-shot local install script

For convenience there is a `build_local.sh` script at the repo root that
builds the plugin and stages the install-ready files in one go:

```bash
./build_local.sh
```

What it does:

1. Runs `npm install` if `node_modules/` is missing.
2. Runs `npm run build` (type check + esbuild production bundle).
3. Reads the plugin id from `manifest.json` and stages `main.js`,
   `manifest.json`, and `styles.css` into `output/<plugin-id>/`.

After the script finishes, copy `output/inline-secret-block/` into
`<Vault>/.obsidian/plugins/` and reload Obsidian. The `output/` directory
is gitignored, so you can run the script as often as you like without
polluting the working tree.

## License

MIT. See [LICENSE](LICENSE).
