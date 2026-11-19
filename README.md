# BTCUSD Sniper Analysis Engine

Multi-timeframe BTCUSD analysis (M15 context, M5 setup, M1 entry check) that runs entirely in the browser.
Educational analysis and paper trading only. It places no orders and connects to no broker.

## What it does
- Fetches Binance M5, M1, 15m candles and the book ticker (spread), or lets you paste JSON.
- Optional Twelve Data key for M15. The key is used for one request and never stored.
- Produces the 9-point report and reports "WAIT — NO CONFIRMED SETUP" unless a structure event plus
  at least three confirmations appear on M5, M1 confirms, spread is acceptable and M15 does not conflict.
- Runs a fixed-rule walk-forward style backtest on the M5 history (60% in-sample, 40% out-of-sample)
  with hit rate, false positives, average R, max drawdown and regime breakdown.
- Claims no confidence figure unless the out-of-sample window has at least 30 simulated trades.

## Deploy on GitHub Pages
1. Create a new repository on GitHub (public, or private on a paid plan).
2. Upload all files from this folder to the repository root (keep the `css` and `js` folders).
3. Go to Settings, then Pages. Under "Build and deployment", set Source to "Deploy from a branch",
   choose branch `main` and folder `/ (root)`, then Save.
4. After a minute, the site is live at `https://YOUR-USERNAME.github.io/YOUR-REPO/`.

No build step, no dependencies, no server. Any static host works (Netlify, Cloudflare Pages, etc.).

## Notes
- Binance BTCUSDT is not identical to an MT5 BTCUSD feed. Expect small price differences.
- Binance has no historical spread. Only the current spread from the book ticker is used.
- The newest Binance candle is dropped when still open, so analysis runs on closed candles.
- If Binance is blocked in your region, paste data manually. The page falls back to two alternate Binance hosts first.
- Backtest results come from one short window of one market. Treat them as indicative, not predictive.
