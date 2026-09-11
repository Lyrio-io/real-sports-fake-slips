# Connect Kalshi on Railway

This version adds a private, read-only Kalshi page to the existing app. The sandbox remains public. Kalshi data never enters the sandbox bet store, Telegram poller, auto-hedge or settlement code. There is no trade placement endpoint.

## Railway setup

1. Deploy this branch to a **separate Railway test environment** first. In the existing **Sports betting Mock** project, use the **real-sports-fake-slips** service (not the Telegram bot). Set its GitHub source to the branch containing this change.
2. In **Variables**, add the following. Use Railway's variable editor; do not commit secrets to GitHub or paste them into the app's Settings.

| Variable | Value |
| --- | --- |
| `KALSHI_ENVIRONMENT` | `demo` to test; `production` for your real account |
| `KALSHI_API_KEY_ID` | Your key ID from the matching Kalshi environment |
| `KALSHI_PRIVATE_KEY` | Complete downloaded PEM private key, including BEGIN/END lines. Multiline text or literal `\n` line separators work. |
| `KALSHI_VIEWER_USER` | A private viewer username without a colon |
| `KALSHI_VIEWER_PASSWORD` | A unique randomly generated password, at least 20 characters. This is separate from your Kalshi login. |
| `NODE_ENV` | `production` |

3. Obtain the API key in Kalshi **Account & security → API Keys → Create Key**. Choose read-only permissions if offered. Match demo keys with demo and production keys with production. Enter the private key directly into Railway. The app never needs your Kalshi login password.
4. Use Node 22 or newer. Keep the start command as `npm start`; remove any old override that runs `serve .`. Railway supplies `PORT`. Optional healthcheck path: `/healthz`. No database or volume is required.
5. Apply the variables and deploy. Open the service's **HTTPS** URL, then **Kalshi · Read only** in the left navigation or the mobile **More** menu. The browser asks for your viewer username/password.
6. Verify cash balance and several open positions against Kalshi, including a No-side position and a combination if held. Change a bucket and reload to confirm it persists on that browser.
7. For real account data, set `KALSHI_ENVIRONMENT=production` and replace both demo credentials with production credentials. This enables real **reads only**. No trade capability is included or enabled by this setting.

The code is ready for deployment; credentials and live-account verification must be completed in your Railway environment. Do not merge into an auto-deploying production branch until the test deployment is reviewed.

## What the figures mean

- **Stake:** Kalshi's aggregate cost of the remaining market position (`market_exposure_dollars`). This is not lifetime trading volume or the original stake before partial sales.
- **Potential payout:** Absolute remaining contracts × the market's settlement notional, for binary markets. This is gross proceeds if that position wins.
- **Potential profit:** Potential payout minus remaining stake, **before fees**. Historical fees cannot reliably be allocated to remaining positions from this endpoint alone, so they are not subtracted or presented as an exact net result.
- **Totals:** Sum of hypothetical individual wins. Conflicting positions may not all win. These totals are not expected returns or current liquidation value.
- **Current portfolio value:** Kalshi's reported value, shown separately from cash and hypothetical winning payout.
- **Combinations/parlays:** Kalshi combination-market positions with their returned constituent legs, not manually multiplied odds. Multiple buys of one market/side are aggregated by Kalshi.
- **Scope:** Primary account (subaccount 0) only. Zero positions and known settled/finalized markets are excluded. Closed positions pending settlement remain visible. Resting orders are not included.
- Missing cost or market metadata makes the affected figure and its total **Unavailable**. Pagination failure rejects the entire refresh. Market metadata failure retains the position and warns it may be awaiting settlement. No missing financial field is treated as zero.
- Yes / Maybe / No are personal organizational labels; they do not change contract sides. Labels are stored only on this device, scoped to environment and API key. A key rotation creates a new label namespace. Clearing browser data deletes labels. Other devices have independent labels. Later buys of the same market/side keep the label.

## Security and operations

The backend signs only balance, position and market GET requests using RSA-PSS/SHA-256. Credentials exist only in server environment variables. API calls cannot select a custom host or HTTP method. Raw upstream errors are never returned to the browser. There are no order creation, cancel, transfer or generic proxy routes.

The Kalshi page and API use HTTP Basic authentication over Railway HTTPS. The private page loads only local assets with a restrictive content security policy. Existing browser profiles are **not** authentication. Only give the viewer password to people allowed to see this one account. Browsers may remember Basic credentials for the browser session; use a private browsing session on shared devices and close it afterward. Rotate the Railway viewer password to revoke access. The server trusts Railway's HTTPS forwarding header; run production behind Railway's proxy, not directly on an exposed HTTP port.

Private responses are `no-store`; the service worker excludes `/kalshi` and `/api/`. The static server serves an explicit public asset list, not the repository root. New public assets must be added to that list. Existing sandbox pages and mock pages keep their normal URLs.

Snapshots are cached in server memory for 30 seconds, concurrent refreshes are coalesced, upstream requests time out after 12 seconds and retry transient errors at most twice. All position pages are fetched (maximum 100 pages; exceeding that returns an error). Market detail fetches use four workers. Very large portfolios may take longer than a browser request; refresh again after the backend finishes. A failed refresh clearly labels previous on-screen data as stale. No credentials, raw API responses or account data are logged.

## Local checks

`npm test` uses generated test keys and mocked Kalshi responses; it makes no Kalshi requests and places no trades. `npm start` serves the original sandbox without any credentials. For a local private-page test, load a local `.env` with Node 22: `node --env-file=.env server.cjs`. Set `NODE_ENV=development` for localhost HTTP only. `.env`, `.key`, and `.pem` files are ignored by Git; never store a key under a public filename.

## References

- [Kalshi authentication](https://docs.kalshi.com/getting_started/quick_start_authenticated_requests)
- [Kalshi positions](https://docs.kalshi.com/api-reference/portfolio/get-positions)
- [Kalshi market metadata](https://docs.kalshi.com/api-reference/market/get-market)
- [Kalshi balance](https://docs.kalshi.com/api-reference/portfolio/get-balance)
- [Railway variables](https://docs.railway.com/guides/variables)

## Sports research and CLV

The private `/research/` page uses the same viewer login. Set `ODDS_API_KEY` (The Odds API) and `ANTHROPIC_API_KEY` in the app service. Optional `ANTHROPIC_MODEL` must support the `web_search_20250305` tool; the default is `claude-haiku-4-5-20251001`. Existing values can be reused. Research consumes provider credits only when requested; odds refreshes consume odds quota. Reports are cached for 15 minutes, odds for 60 seconds, and research is limited to 20 new reports per hour per process. Quotas reset on restart and are not distributed across replicas.

Only upcoming moneyline matchups are included. Quotes older than 15 minutes are excluded. The market baseline removes margin within each bookmaker and averages the resulting probabilities; it is not an independently calibrated forecast. AI web research distinguishes cited facts, possible impacts, market pricing, and a tentative lean or Pass. Travel, time zones, injuries and weather can inform interpretation but do not create a proven edge. Reports require citations and a completed provider response. Source quality and late changes still require judgment. No Kalshi account data is sent to the AI service.

The paper journal saves only in the current browser. Save a quote before kickoff, then refresh before kickoff for a same-book reference. After kickoff, CLV proxy = entry decimal odds / last observed pregame decimal odds − 1. The reference must have been updated after the entry and within 10 minutes before kickoff. Missing references remain unavailable. This is not a guaranteed final closing quote and does not collect in the background. Different books, outcomes, in-play prices and missing data cannot substitute for the reference. CLV measures price quality after entry; it cannot be known when making the original pick and does not guarantee a win.

The original sandbox's closing-line collector also now uses same-book, same-point observations only before kickoff. Old post-kickoff snapshots are retained in storage but excluded from metrics. Its cents figure is a difference in decimal-odds return per $1 stake; the new journal uses the ratio definition above. This release is a research workflow, not a backtested or calibrated sports forecasting model. Training one would require timestamped historical features, closing prices, results, and out-of-sample evaluation.

`POST /api/research/briefing` generates analysis only. All Kalshi routes remain GET-only, with no trade placement. The private research page shares authentication and no-store protections; `/research` is also excluded from service-worker caching.
