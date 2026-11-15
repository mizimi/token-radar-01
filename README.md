# Token Radar — token-radar-01 entry

A radar for protocols that record no token yet: what a token would be worth if the protocol
issued one at its current record, and what to do to farm each protocol before it does.

## Run it

```
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-snapshot.json>
```

Node 22, standard library only. Writes `board.json`, `data.js`, `dashboard/`, `screenshots/`
and `dossier.json` into the output directory, deterministically — two runs, same bytes.

## The model (radar-2, in lib/model.ts)

```
peers(category)   = the snapshot's tokenised protocols in that category (mcap > 0, tvl > 0)
category_multiple = clamp((n * median(mcap/tvl of peers) + 6 * global_median) / (n + 6), 0.03, 2.00)
growth_mult       = 1 + clamp(change_7d, -60, +120) / 100 * 0.5
maturity_mult     = 0.6 + min(age_days, 1095) / 1095 * 0.4     (unknown age counts as 365 days)
implied_value_usd = max(1, round(tvl_usd * category_multiple * growth_mult * maturity_mult))
```

The snapshot's own 128 trading protocols are the evidence: a lending protocol is priced at
what lending tokens actually fetch per dollar of TVL, not at one flat multiple for everything.
Shrinkage toward the global median keeps a category with a single lucky peer from pricing
every protocol in it at that peer's multiple. The board ranks every watchlist protocol plus
every other rankable pre-token protocol (not a wrapped, staked or bridged product of a token
that already trades); live-token protocols are set aside with their real market caps.

Each row's farm plan is derived from its own record: the category sets the actions, the first
chain prices the gas (Ethereum mainnet apart from L2s), the TVL sizes the capital, and the
age sets the hold. The dashboard (dashboard/, dark, no network) renders the same data.js the
program writes from board.json, recomputes each row's implied value in the detail view, and
shows the farm plan exactly as the board carries it.
