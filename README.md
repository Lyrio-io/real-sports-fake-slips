# Real Sports Fake Slips

Sandbox sports betting app — practice with fake money, keep your real money.

## Run locally
```
npm install
npm start
```
Then open http://localhost:8080

## Deploy
Railway auto-detects `package.json` and runs `npm start` using its assigned `PORT` (8080 locally). Requires Node 22 or newer. Remove any old start-command override that runs `serve .`.

## Kalshi (read-only)

Open **Kalshi · Read only** in the sidebar or mobile More menu. The original sandbox still runs without credentials; the private Kalshi view stays locked until server variables are configured.

See [KALSHI_SETUP.md](KALSHI_SETUP.md) for Railway variables, password protection, deployment, calculation definitions and limitations. Run `npm test` for isolated signing, math, pagination and route-security checks.

### Sports research

Open **Sports research** for current moneyline market probabilities, cited AI matchup reports, and a browser-local paper CLV journal. Uses server-only Odds API and Anthropic keys; see [setup](KALSHI_SETUP.md#sports-research-and-clv). Research separates verified reporting from interpretation and does not claim a calibrated winning model. No bets are placed.
