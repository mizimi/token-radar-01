# token-radar-01 — build plan (2026-11-16)

## What the gate demands (from kit RULES.txt)
- main.ts (Node 22, stdlib only) reads /input/snapshot.json (or --input), writes /output/board.json,
  /output/data.js, copies dashboard/ + screenshots/ to /output, writes /output/dossier.json via
  buildDossier('/output', {text_max_bytes: 65536}) — byte-for-byte what the scorer rebuilds.
- board.json: {rows:[...]} 100–4000 rows; ranks exactly 1..N; implied_value_usd positive whole ≤ 1e14,
  non-increasing as rank ascends, not all equal; every watchlist slug present; farm_steps 3–12 strings,
  each 20–600 chars trimmed; slugs must be snapshot protocols; ≤ 8 MiB.
- dashboard/: index.html + ≥1 .css + ≥1 .js, ≤400 files, ≤4 MiB, plain names, NO http(s):// in any
  HTML attribute, CSS file, or JS import/export/require specifier. Keep total dashboard source < 64 KB
  so the dossier text shows it whole.
- screenshots/: 3–4 whole PNG/JPEG, ≤512 KiB each, long side ≤1440, short side ≥800. Aim ~300–350 KB.
- Program runs twice in the grader → output must be byte-identical across runs (deterministic:
  no Date.now, no randomness; all ordering tie-broken by slug).

## Snapshot facts (measured 2026-11-16)
- as_of 2026-11-14, floor $50M, 758 protocols, watchlist 40, pre-token 342, tokenized with
  mcap+tvl>0: 128 peers. Global median mcap/TVL = 0.2227.

## My model (differs from the starter's flat TVL × 0.25)
implied = round( tvl_usd × category_multiple × growth_mult × maturity_mult )
- category_multiple: the snapshot's own market evidence. For each category, take the median
  mcap/TVL of its tokenized protocols (mcap>0, tvl>0), shrunk toward the global median with
  weight k=4 peers: mult = (n·catMedian + 4·globalMedian)/(n+4), clamped to [0.03, 2.50].
  A category with no tokenized peers uses the global median. This answers "what would a token
  be worth" with what the market actually pays for TVL in that line of business.
- growth_mult = 1 + clamp(change_7d, −60, +120)/100 × 0.5   (as starter; judge criterion 2 names it)
- maturity_mult = 0.6 + min(age_days, 1095)/1095 × 0.4      (unknown age → 365 d)
- Board: all 40 watchlist + every other rankable pre-token protocol (pre-token, not a wrapped/
  staked/bridged product category, no versioned/exchange name) — expected ~330 rows, well past
  the 100-row floor; the radar's job is early finds, so no TVL cap on early rows.
- Live-token protocols stay a separate view with real mcaps (never ranked).

## Farm steps (6 per row, all derived from the row's own record)
Fresh-wallet setup → category action with capital sized by TVL band and gas priced by chain
class (Ethereum mainnet vs L2/sidechain) → weekly qualifying action → hold window from age →
points/eligibility check before exit → farm log. Category actions cover lending/CDP, DEX/yield,
bridge, staking/restaking, perps, prediction, curator/allocator, stablecoin, RWA, insurance,
chain, launchpad + default. model.ts and dashboard app.js carry the same derivation (starter's
pattern) so page and board.json agree word for word.

## Dashboard (rebuilt, not the starter's page)
Dark "night radar" identity: deep ink-navy canvas, amber accent, mono numerals. Sticky header,
stat strip, controls = search + category select + chain select + watchlist-only toggle + pre-token/
live tabs; sortable table with implied/TVL multiple column and top-3 rank chips; detail drawer
shows the full model breakdown (category multiple + peer count, growth, maturity) and the farm
plan. data.js gains farm_steps per row so the page renders exactly board.json's steps.

## Screenshots
Render out/dashboard at 1440×900 in a headless browser (availability being checked), capture
1-board, 2-detail (top row's drawer open), 3-filtered (a category filter applied), save as JPEG
q≈82 targeting 300–350 KB each, verify dimensions + that buildDossier accepts them.

## Verify before commit
- node main.ts runs clean against kit input; boardIssue() returns null.
- Independent gate re-check script: ranks/coverage/step lengths/value caps, dossier rebuilt from
  the output dir equals dossier.json byte-for-byte, two runs byte-identical.
- data.js parses and contains the ranked rows; dashboard files contain no http(s) references.

## Results (2026-11-16)
- Built and committed: repo ~/workspace/makefun/work/token-radar-01, commit
  7f2d6a718e21860d2fd37c4a746a00714802ff19 (git user mizimi). NOT submitted, NOT pushed.
- Model as planned, with peer_shrink_k = 6 and multiple_cap = 2.00 (a first run at k=4/2.50 let
  the single-peer Risk Curators category price five of the top eight rows; k=6 pulls it to 0.6006x).
- Board: 192 rows (40 watchlist + 152 early), top row steakhouse-financial at $1,306,031,319
  implied (TVL $2.754B x 0.6006 category multiple x 0.9890 growth x 0.7984 maturity).
  board.json 383 KB, data.js 372 KB, dashboard source 30,669 bytes (shown whole in the dossier,
  text 30,933 bytes, no cut), dossier.json 918,568 bytes (cap 1.5 MiB).
- Screenshots: real renders of this dashboard at 1440x900 via puppeteer chrome-headless-shell
  (the VM's managed /opt/meta-chromium refuses CLI startup; /tmp is a 512 MB tmpfs, so the
  puppeteer install lives in /tmp/shotter and is ephemeral — reinstall to re-shoot):
  1-board.png 212,711 B (board), 2-detail.png 253,450 B (Steakhouse detail drawer, recompute
  agrees with board.json), 3-filtered.png 198,728 B (Category = Lending, 16 of 192 rows).
  All within caps (<=512 KiB, long side 1440, short side 900).
- Verification (independent re-check, /tmp/verify.mjs): ranks exactly 1..N, implied non-increasing,
  all 40 watchlist slugs covered, no invented slugs, every farm step 155-323 chars trimmed,
  no http(s) address anywhere in dashboard files, dossier.json byte-identical to a fresh
  buildDossier rebuild of the output dir, and two full runs of main.ts byte-identical
  (board.json, data.js, dossier.json). ALL GATE CHECKS PASS.
- Transcript record for the later bundle: this build's code was written in session
  ~/agents/agent-d29cf426-2413-4794-8836-c577b8dd8645/sessions/d29cf426-2413-4794-8836-c577b8dd8645.jsonl
  (the building subagent's session); the parent session is
  ~/agents/agent-36f735eb-0576-4f25-a54e-e21e3c2c8418/sessions/36f735eb-0576-4f25-a54e-e21e3c2c8418.jsonl.
- Remaining before submission (parent's steps): create the public GitHub repo under mizimi with
  .makefun/owner.json if needed, bundle transcripts (kit CLI, --muse-usage like the chess entry),
  run `node cli/makefun.mjs check`, then submit. Deadline 2026-12-14T10:00:00Z.
