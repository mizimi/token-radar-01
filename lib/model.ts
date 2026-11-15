// Token Radar's model: one sealed snapshot in, one ranked board out.
//
// THE MODEL (version radar-2)
// A pre-token protocol's implied value is what the market would plausibly pay for its token if it
// issued one at its current record. The snapshot itself carries the evidence: 128 of its protocols
// already trade, and each of them states a market cap against a TVL. So the model prices TVL the
// way the market already prices it in the same line of business:
//
//   peers(category)  = the snapshot's tokenised protocols in that category (mcap > 0, tvl > 0)
//   category_multiple = clamp( (n * median(mcap/tvl of peers) + K * global_median) / (n + K),
//                              0.03, 2.00 )        with K = 6, global_median over all 128 peers
//   growth_mult       = 1 + clamp(change_7d, -60, +120) / 100 * 0.5
//   maturity_mult     = 0.6 + min(age_days, 1095) / 1095 * 0.4    (unknown age counts as 365 days)
//   implied_value_usd = max(1, round(tvl_usd * category_multiple * growth_mult * maturity_mult))
//
// The shrinkage keeps a category with two lucky peers from pricing every protocol in it at 19x
// TVL, and the clamp keeps any single multiple inside what the snapshot's own market shows. No
// protocol name is ever special-cased: one function scores every row, and the dashboard recomputes
// each row from the same figures so the page and board.json cannot drift apart.
//
// THE BOARD
// Every watchlist slug is ranked (the gate's floor), plus every other rankable pre-token protocol
// in the snapshot: the early rows are the radar's reason to exist, so there is no TVL cap on them.
// A protocol is rankable when it records no token and is not a wrapped, staked or bridged product
// of a token that already trades (the house's own watchlist logic, applied below the floor too):
// product categories, versioned pool names, wrapped/staked names and exchange-prefixed names are
// left out of the early set. Live-token protocols are never ranked; the dashboard sets them aside
// with their real market caps.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, stated in the dashboard so a reader can re-run the arithmetic. */
export interface ModelConstants {
  peer_shrink_k: number;
  multiple_floor: number;
  multiple_cap: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
}

export const MODEL: ModelConstants = {
  peer_shrink_k: 6,
  multiple_floor: 0.03,
  multiple_cap: 2.0,
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
};

/** The model's version label: the dashboard names it and the detail view quotes it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the dashboard's Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step before it is flattened: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    category_multiple: number;
    category_peers: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's view of one row: everything the page renders, farm plan included. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  category_multiple: number;
  category_peers: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  farm_steps: string[];
  watchlist: boolean;
}

/** A live-token protocol: it already trades, so the board shows the market's value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model that scored it. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** Whole days from `listedAt` to `asOf`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The lower median of a non-empty list: sorted, the middle value (the lower of the two middles). */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)]!;
}

/**
 * The market's own pricing of TVL, read off the snapshot: for every category, the shrunk median
 * mcap/TVL of its tokenised peers, plus the global multiple a category with no peers falls back to.
 */
export function categoryMultiples(snapshot: Snapshot, model: ModelConstants): { byCategory: Map<string, { multiple: number; peers: number }>; global: { multiple: number; peers: number } } {
  const ratiosByCategory = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    all.push(ratio);
    const key = p.category ?? '';
    const list = ratiosByCategory.get(key);
    if (list === undefined) ratiosByCategory.set(key, [ratio]);
    else list.push(ratio);
  }
  const globalMedian = all.length > 0 ? median(all) : 0.25;
  const shrink = (catMedian: number, n: number): number =>
    Math.min(model.multiple_cap, Math.max(model.multiple_floor, round4((n * catMedian + model.peer_shrink_k * globalMedian) / (n + model.peer_shrink_k))));
  const byCategory = new Map<string, { multiple: number; peers: number }>();
  for (const [key, ratios] of ratiosByCategory) {
    byCategory.set(key, { multiple: shrink(median(ratios), ratios.length), peers: ratios.length });
  }
  return { byCategory, global: { multiple: shrink(globalMedian, all.length), peers: all.length } };
}

/** One protocol's score under the model: its implied value and every multiplier that produced it. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  multiples: { byCategory: Map<string, { multiple: number; peers: number }>; global: { multiple: number; peers: number } },
): { implied: number; multiple: number; peers: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, finite(protocol.change_7d, 0)));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const entry = multiples.byCategory.get(protocol.category ?? '') ?? multiples.global;
  const implied = Math.max(1, Math.round(protocol.tvl_usd * entry.multiple * growthMult * maturityMult));
  return { implied, multiple: entry.multiple, peers: entry.peers, growthPct, growthMult, maturityMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** A whole word wrapped, staked or staking in the name: a product of a token that already trades. */
const WRAPPED_NAME = /\b(wrapped|staked|staking)\b/i;
/** Names that begin with an exchange's name are that exchange's product, not a launch candidate. */
const EXCHANGE_NAME = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)(\s|$)/;
/** Categories that are products of another protocol's token rather than protocols awaiting one. */
const PRODUCT_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Cross Chain Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
  'Stablecoin Wrapper',
  'Anchor BTC',
  'Decentralized BTC',
]);

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol may join the early board: pre-token and not a product of a trading token. */
export function isRankable(p: SnapshotProtocol): boolean {
  return (
    isPreToken(p) &&
    !PRODUCT_CATEGORIES.has(p.category ?? '') &&
    !VERSIONED.test(p.name) &&
    !WRAPPED_NAME.test(p.name) &&
    !EXCHANGE_NAME.test(p.name)
  );
}

function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const multiples = categoryMultiples(snapshot, model);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug is ranked, whatever the early filters would say.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every other rankable pre-token protocol, at any TVL the snapshot carries.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }
  const scored = [...chosen.values()].map((p) => ({ p, ...impliedValue(p, snapshot.as_of, model, multiples) }));
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      category_multiple: s.multiple,
      category_peers: s.peers,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

/** A step as one string: its action, then its cost and time, inside the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** What one transaction costs on a chain: Ethereum mainnet is priced apart from every L2 and sidechain. */
function gasFor(chain: string): string {
  return chain === 'Ethereum' ? 'about $15 of ETH in gas' : 'about $2 in gas';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's opening action, in words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('uncollateralized')) return `Lend $${capital} of USDC into ${name}'s credit pool on ${chain}; uncollateralised lending carries default risk, so keep the position small.`;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC as collateral to ${name} on ${chain}, then borrow about 30% against it and supply the borrow back once.`;
  if (c.includes('dex') || c.includes('liquidity manager')) return `Provide $${capital} split evenly between USDC and ETH in ${name}'s main pool on ${chain} and keep the LP position open.`;
  if (c.includes('yield') || c.includes('farm') || c.includes('leveraged')) return `Deposit $${capital} of USDC into ${name}'s largest vault on ${chain} and leave the vault shares untouched.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name}, then make one deposit inside its app so the trip counts as use, not transit.`;
  if (c.includes('staking') || c.includes('restak') || c.includes('staking pool')) return `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the staking receipt in the same wallet.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedged position, half long and half short, so the account trades without directional risk.`;
  if (c.includes('prediction')) return `Fund $${capital} on ${name} and take one position in each of two liquid markets, sized under $${Math.max(10, Math.floor(capital / 5))} each.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into the largest curated vault ${name} runs on ${chain} and keep the vault shares.`;
  if (c.includes('stable') || c.includes('algo')) return `Mint $${capital} of ${name}'s stable asset against collateral on ${chain}, then hold half and pool half against USDC.`;
  if (c.includes('rwa')) return `Subscribe $${capital} to ${name}'s yield asset on ${chain} and hold it; complete any eligibility form the app itself presents.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} for the largest protocol you already use, and keep the policy to expiry.`;
  if (c === 'chain') return `Bridge $${capital} to ${name}'s chain, keep a small balance of its gas asset, and make one deposit in two of its native apps.`;
  if (c.includes('launchpad')) return `Register the wallet with ${name} and take part in one launch with $${capital}, following the allocation steps its page sets out.`;
  if (c.includes('privacy')) return `Deposit $${capital} into ${name}'s shielded pool on ${chain} and make one private transfer to a second wallet you own.`;
  if (c.includes('payment') || c.includes('card')) return `Open a ${name} account from the wallet, fund $${capital}, and make two small real payments so the account shows genuine use.`;
  if (c.includes('nft')) return `Buy one low-priced listing on ${name} and list one item of your own, keeping both trades under $${capital} in total.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** The category's weekly qualifying action: the repeat visit that keeps a farm alive. */
function weeklyFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return 'adjust the borrow by a few dollars or repay and re-borrow once';
  if (c.includes('dex') || c.includes('liquidity manager')) return 'make one small swap through the pool you farm';
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return 'roll the hedge or trade a few dollars of volume';
  if (c.includes('staking') || c.includes('restak')) return 'claim and restake the staking rewards';
  if (c.includes('prediction')) return 'take one small position in a new market';
  if (c.includes('curator') || c.includes('allocator')) return 'add a few dollars to the vault, or move a small amount from one of its vaults to another';
  if (c.includes('bridge')) return 'bridge a few dollars back or forth once';
  return 'make one small deposit, withdrawal or vote';
}

/** The category's standing risk, named in the hold step so the plan is honest about the position. */
function riskFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('dex') || c.includes('liquidity manager')) return 'Watch the pool weekly: impermanent loss grows when the pair drifts, and a farm is not worth a deep loss.';
  if (c.includes('staking') || c.includes('restak')) return 'Mind the unbonding period and slashing rules before you stake more; locked stake cannot leave early.';
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return 'Keep the hedge balanced: an unbalanced margin position can be liquidated, and liquidation ends the farm.';
  if (c.includes('uncollateralized')) return 'This is uncollateralised credit: if a borrower defaults the pool takes the loss, so never add beyond the starting capital.';
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return 'Keep the health factor comfortably above liquidation; a liquidation closes the position and the history with it.';
  return 'Check the position weekly and never add capital you cannot leave in place for the whole window.';
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time, all derived from the
 * protocol's own record — its category sets the actions, its first chain prices the gas, its TVL
 * sizes the capital and its age sets the hold. No name is hand-written anywhere in the plan.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasFor(chain);
  const others = p.chains.filter((c) => c !== chain).slice(0, 2);
  return [
    {
      text: `Set up a fresh wallet for this farm alone, back its seed phrase up offline, and fund it on ${chain} with the gas asset plus $${capital} of USDC${others.length > 0 ? `; ${p.name} also runs on ${others.join(' and ')}, but one chain farmed well beats three farmed thin` : ''}.`,
      cost: `${gas} to fund and approve`,
      time: '10 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital in the position and ${gas}`,
      time: '15 minutes to set up',
    },
    {
      text: `Return once a week and ${weeklyFor(p)}, so the wallet reads as a user of ${p.name} and not a one-day visitor.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days, across several weekly snapshots of the protocol's usage. ${riskFor(p)}`,
      cost: `the $${capital} stays in the position for the whole window`,
      time: `${hold} days`,
    },
    {
      text: `Each week, open ${p.name}'s own points or rewards page if it has one and record your balance or points in the farm log; claim only from a link that page publishes, and never pay anyone to claim for you.`,
      cost: 'nothing to check; a claim fee asked by a third party is a scam',
      time: '10 minutes a week',
    },
    {
      text: `Keep a farm log with the wallet, the dates, the transaction hashes and the balances; if ${p.name} announces a token, verify the contract address in its own channels before claiming, then unwind or keep the position on its merits.`,
      cost: 'nothing but the log',
      time: '5 minutes a week, 20 minutes at any claim',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's form for data.js: the same figures, the same farm plan, the watchlist flag. */
export function radarRow(row: BoardRow, watchlist: Set<string>): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    category_multiple: row.model.category_multiple,
    category_peers: row.model.category_peers,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    farm_steps: row.farm_steps,
    watchlist: watchlist.has(row.slug),
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const watchlist = new Set(snapshot.watchlist);
  const early = board.filter((r) => !watchlist.has(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map((r) => radarRow(r, watchlist)),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared value, farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside the gate's 100 to 4000`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters once trimmed`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
