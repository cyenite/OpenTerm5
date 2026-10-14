# Security policy

OpenTerm5 handles trading account credentials and can place orders with real money. We take security
reports seriously and appreciate responsible disclosure.

## Supported versions

Security fixes are made on the latest release and on `main`. Older releases are not patched; please
upgrade.

## Reporting a vulnerability

**Do not open a public issue for a security problem.**

Report it privately through GitHub:
[**Report a vulnerability**](https://github.com/cyenite/OpenTerm5/security/advisories/new).

Please include:

- the affected version or commit;
- a description of the issue and its impact;
- steps to reproduce, or a proof of concept;
- any suggested fix.

Never include real account passwords, live account numbers or broker session data in a report. A
demo account is enough to demonstrate a problem.

### What to expect

- We acknowledge your report within **3 working days**.
- We give an initial assessment within **10 working days**.
- We keep you informed until the issue is fixed. We credit you in the release notes unless you
  prefer to stay anonymous.

Please give us reasonable time to release a fix before disclosing the issue publicly. We aim to fix
critical issues within 30 days.

## Scope

Reports in these areas are especially valuable:

- **Credential handling:** passwords and webhook secrets kept in memory, encrypted with the operating
  system keychain (`safeStorage`) and stored under the app's data directory.
- **Broker address detection:** a guessed host should never receive a password without the user's
  explicit approval (`electron/broker-directory.ts`).
- **The webhook signal server:** authentication, HMAC verification, replay protection, rate limits
  and request parsing (`electron/webhook-server.ts`, `electron/webhook-signal.ts`).
- **Electron hardening:** context isolation, the preload bridge, navigation and window-open handling,
  and the Content Security Policy.
- **Order safety:** any way to make OpenTerm5 send an order the user did not request, or repeat one.

Out of scope:

- vulnerabilities in a broker's server or in MetaQuotes' services;
- attacks that need an already compromised machine or user account;
- a webhook server deliberately exposed to the internet over plain HTTP, against the documented
  advice to use an HTTPS tunnel or reverse proxy.

## Good practice for users

- Download OpenTerm5 only from this repository's releases page.
- Keep **Save password securely** off on shared computers.
- Keep the signal server bound to `127.0.0.1`. Publish it through an HTTPS tunnel or reverse proxy
  only when you need to.
- Use a strong, unique secret for every signal source, and rotate it if it may have leaked.
