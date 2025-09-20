
# Hyperliquid Delta Neutral Yields Dashboard

A real-time dashboard for monitoring annualized yields from delta-neutral strategies on Hyperliquid perpetuals (long spot/short perp). Built with Next.js and Tailwind CSS, it fetches live funding rates via the Hyperliquid API, calculates APYs, and displays active assets in a sortable table.

## Features
- Live yields for all active perps (e.g., BTC, ETH, SOL).
- Sortable table with funding rates, open interest, and max leverage.
- HLP vault yield integration for comparison.

Deployed on Vercel: [hyperdn-table.vercel.app](https://hyperdn-table.vercel.app)

## Setup
1. Clone the repo: `git clone https://github.com/yourusername/hyperdn-table.git`
2. Install: `npm install`
3. Run: `npm run dev`

See [CONTRIBUTING.md](CONTRIBUTING.md) for more.
