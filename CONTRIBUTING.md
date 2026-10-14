# Contributing to OpenTerm

Thank you for helping build OpenTerm. This guide explains how to set up a development environment,
how the project is organised and what a pull request needs before it can be merged.

By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md). Security problems
must not be reported in public issues; see [SECURITY.md](SECURITY.md).

## Ways to contribute

- **Report a bug** with the bug report form. Include the OpenTerm version, your OS, the broker server
  (for example `MetaQuotes-Demo`) and the steps that reproduce the problem.
- **Suggest a feature** with the feature request form. Explain the trading workflow it supports.
- **Improve the documentation.** Fixes to `docs/` are always welcome and are a good first contribution.
- **Fix an issue.** Issues labelled `good first issue` are self-contained and well described.
- **Test with your broker.** OpenTerm is verified against a small number of brokers. Reports from
  other brokers, especially their web trading address, help everyone (see
  [Accounts and brokers](docs/user-guide/accounts-and-brokers.md#adding-a-broker-to-the-directory)).

Please open an issue to discuss large changes before you start, so we can agree on the approach.

## Development setup

Requirements:

- Node.js 22.12 or later (the version in `.nvmrc`) and npm.
- Git.
- On Linux, a desktop session. To save passwords you also need a Secret Service keyring
  (GNOME Keyring or KWallet).

```bash
git clone https://github.com/cyenite/OpenTerm5.git
cd OpenTerm5
npm ci
npm run dev
```

`npm run dev` starts the Vite dev server for the interface and launches Electron against it.
Interface changes reload automatically; changes under `electron/` need the command to be restarted.

The public MetaQuotes demo server (`MetaQuotes-Demo`) works without any broker relationship and is the
best server for development. Open a free demo account from the MetaTrader 5 mobile or desktop app, or
on the MetaQuotes website.

If Electron exits on Linux with a sandbox error, see
[Troubleshooting](docs/troubleshooting.md#electron-will-not-start-on-linux-sandbox-error).

## Useful commands

| Command | What it does |
|---|---|
| `npm run dev` | Run the app with hot reload |
| `npm test` | Run the unit and integration tests (Node's test runner via `tsx`) |
| `npm run typecheck` | Type-check the interface and the Electron main process |
| `npm run build` | Production build into `dist/` and `dist-electron/` |
| `npm run check` | Typecheck, tests and build: run this before opening a pull request |
| `npm run dist:linux`, `dist:mac`, `dist:win` | Package installers into `release/` |
| `npm run probe:mt5-web` | Read-only connection diagnostic (see [Testing](docs/development/testing.md)) |

## Project layout

```
electron/   Main process: MT5 web protocol client, session pool, automation engines, webhook server
shared/     Types and pure logic used by both processes (protocol contract, risk maths, valuation)
src/        Interface (React): components, dialogs, chart, pages and renderer state
scripts/    Developer tools
docs/       User and developer documentation
.github/    Issue and pull request templates, CI workflows
```

[Architecture](docs/development/architecture.md) describes how these pieces fit together.

## Coding guidelines

OpenTerm is written in strict TypeScript. Match the style of the code around your change. The main
conventions are:

- **Group declarations by kind, then by name length.** Class fields, constructor parameters and blocks
  of local variables are grouped by type, shortest name first.
- **Comments explain why, not what.** Add a comment only for a workaround, a protocol quirk or a
  non-obvious ordering requirement. Do not add section banners or restate the code.
- **Components are components.** Extract a React component with named props instead of a function
  that returns markup inside another component.
- **Prefer immutability.** Use `readonly` fields and `const`. Collections default to an empty array
  or object rather than `undefined`.
- **Names describe behaviour.** Booleans start with `is`, `has` or `can`. Sibling fields have parallel
  names (`startPrice`/`endPrice`). Enums carry their own label and ordering. Do not keep a separate
  list in sync with them.
- **No silent failures.** Surface errors through the journal or the caller instead of returning an
  empty value.
- **Money and orders are never guessed.** Do not show an invented figure. Do not retry a trade request
  whose outcome is unknown.

## Tests

Every behaviour change needs a test. Tests live next to the code (`*.test.ts`) and use `node:test`
with `node:assert/strict`.

- Pure logic (risk sizing, valuation, layout maths) is tested directly.
- Protocol parsers are tested with byte layouts built in the test. Never commit captured broker
  traffic: it can contain account numbers and balances.
- Engines (trade manager, copier, signal executor) are tested against `electron/automation-fixtures.ts`,
  an in-memory broker.

Changes that touch order sending should also be checked manually on a demo account. Describe what
you verified in the pull request.

## Commit messages

- Write the subject in the imperative mood, at most about 70 characters: `Add trailing stop to the
  risk ticket`.
- Use the body to explain why the change is needed and any trade-offs.
- Keep each commit focused on one change.

## Pull requests

1. Fork the repository and create a branch from `main`.
2. Make your change with tests and documentation.
3. Run `npm run check`.
4. Open a pull request and fill in the template.

A maintainer reviews every pull request. CI must pass on Linux, macOS and Windows before merging.
For user-visible changes, add an entry under **Unreleased** in [CHANGELOG.md](CHANGELOG.md).

## Licence

OpenTerm is released under the [MIT License](LICENSE). By contributing, you agree that your
contributions are licensed under the same terms.
