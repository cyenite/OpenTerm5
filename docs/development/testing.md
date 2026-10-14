# Testing

## Automated tests

```bash
npm test             # all tests
npm run check        # typecheck, tests and production build
npx tsx --test electron/copier.test.ts   # a single file
```

Tests use Node's built-in test runner (`node:test`) through `tsx`, with `node:assert/strict`. They live
next to the code they test, as `*.test.ts`, in `electron/`, `shared/` and `src/lib/`.

| Area | Approach |
|---|---|
| Pure logic: risk sizing, valuation, order planning, chart window layout | Call the function and assert on the result |
| Protocol parsers and encoders | Build the byte layout in the test with `BinaryWriter` and parse it |
| Account session (`Mt5WebLink`) | A fake client that records commands and emits notifications |
| Engines: trade manager, copier, signals | `electron/automation-fixtures.ts`, an in-memory broker with `FakeLink` |
| Webhook server | A real HTTP server on a random local port |

Guidelines:

- Each test describes one behaviour in its name.
- Do not depend on the network, the clock or test order. Inject `now` where time matters.
- Never commit captured broker traffic or real account data. Recreate the layout in the test instead.

CI runs `npm run typecheck`, `npm test` and `npm run build` on Linux, macOS and Windows for every
pull request.

## Manual verification on a demo account

Changes to order sending, chart trading or the engines should also be checked on a demo account,
because fixtures cannot reproduce every broker behaviour. The public `MetaQuotes-Demo` server is
suitable.

A useful checklist:

1. Log in, open a chart and confirm quotes and bars update.
2. Place a small market order with a stop loss, then confirm it appears in Toolbox → Trade and on the
   chart.
3. Drag its stop loss on the chart, apply the change, and confirm the new level in Toolbox → Trade.
4. Place a pending order far from the price, move it on the chart, then delete it.
5. Close the position partially from the position dialog, then fully.
6. Confirm the deals appear in Toolbox → History, and that the Journal reports every step.

Use the smallest volume the symbol allows, and close everything you open. Describe what you verified
in your pull request.

## Connection diagnostics

```bash
npm run probe:mt5-web
npm run probe:mt5-web -- --credentials /absolute/path/to/demo.json
```

The first command checks that a session can be opened. The second logs in with a JSON file containing
`{"login": "12345678", "password": "…"}` (and optionally `"otp"`) and prints live quotes for 15 seconds.
The probe never sends orders. Keep the credentials file outside the repository.
