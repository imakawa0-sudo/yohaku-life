import type { GameState, LocationId, Resources } from "./types";
import type { CoinRegionReceipt } from "./region";

export type CoinChoice = "sell-scrap" | "buy-food" | "buy-medicine";
export type CoinTransferFact = { from: string; to: string; amount: number; location: LocationId };
export type CoinTransfer = CoinTransferFact & { logId: number; time: number; actorId: string };
export type CurrencyState = { version: 1; transfers: CoinTransfer[] };
export const VILLAGE_COINS_TERMS_ID = "village-coins-v1" as const;
export const VILLAGE_DAILY_CASH = 6;
export const COIN_WEIGHT = 0.01;
type CoinOffer = { paid: Partial<Resources>; received: Partial<Resources>; coinsPaid: number; coinsReceived: number };
const offer = (paid: Partial<Resources>, received: Partial<Resources>, coinsPaid: number, coinsReceived: number): CoinOffer =>
  Object.freeze({ paid: Object.freeze(paid), received: Object.freeze(received), coinsPaid, coinsReceived });
/** Historical fixed terms; a later price belongs to a different terms ID. */
export const VILLAGE_COIN_OFFERS: Readonly<Record<CoinChoice, CoinOffer>> = Object.freeze({
  "sell-scrap": offer({ scrap: 1 }, {}, 0, 2),
  "buy-food": offer({}, { food: 3 }, 4, 0),
  "buy-medicine": offer({}, { medicine: 1 }, 2, 0),
});
export function isCoinChoice(value: unknown): value is CoinChoice {
  return value === "sell-scrap" || value === "buy-food" || value === "buy-medicine";
}
function coinReceipts(s: GameState): CoinRegionReceipt[] {
  return Array.isArray(s.region?.receipts) ? s.region.receipts.filter((entry): entry is CoinRegionReceipt =>
    !!entry && isCoinChoice(entry.choice) && entry.termsId === VILLAGE_COINS_TERMS_ID) : [];
}
function coinTransfers(s: GameState): CoinTransfer[] {
  return Array.isArray(s.currency?.transfers) ? s.currency.transfers.filter((entry) => !!entry && typeof entry === "object") : [];
}
/** All established receipts, independent of the history panel's display limit. */
export function getWalletCoins(s: GameState, residentId: string): number {
  const earned = coinReceipts(s).reduce((sum, entry) => entry.actorId === residentId
    ? sum + entry.coinsReceived - entry.coinsPaid : sum, 0);
  return coinTransfers(s).reduce((sum, entry) => sum + (entry.to === residentId ? entry.amount : 0)
    - (entry.from === residentId ? entry.amount : 0), earned);
}
/** A new day's projected budget is read without creating or replenishing state. */
export function getVillageCash(s: GameState): number {
  const day = Math.floor(s.minutes / 1440);
  return coinReceipts(s).reduce((sum, entry) => Math.floor(entry.time / 1440) === day
    ? sum + entry.coinsPaid - entry.coinsReceived : sum, VILLAGE_DAILY_CASH);
}

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const whole = (value: unknown, min = 0): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= min;
type MoneyEvent = { logId: number; time: number } & (
  { kind: "trade"; actorId: string; coinsPaid: number; coinsReceived: number }
  | { kind: "transfer"; from: string; to: string; amount: number }
);

/** Validate financial prefixes across both histories without sorting saved arrays. */
export function validCurrencyLedger(s: GameState): boolean {
  if (!whole(s.minutes) || !whole(s.nextId, 1) || !Array.isArray(s.residents)) return false;
  const ids = new Set(s.residents.filter((r) => record(r)).map((r) => r.id));
  if (s.region !== undefined && (!record(s.region) || !Array.isArray(s.region.receipts))) return false;
  if (s.currency !== undefined && (!record(s.currency) || s.currency.version !== 1 || !Array.isArray(s.currency.transfers))) return false;
  const events: MoneyEvent[] = [];
  let previousId = 0, previousTime = -1;
  for (const entry of s.region?.receipts ?? []) {
    if (!record(entry)) return false;
    if (!isCoinChoice(entry.choice)) continue;
    const offer = VILLAGE_COIN_OFFERS[entry.choice];
    if (entry.termsId !== VILLAGE_COINS_TERMS_ID || !ids.has(entry.actorId)
      || !whole(entry.logId, 1) || entry.logId >= s.nextId || entry.logId <= previousId
      || !whole(entry.time) || entry.time > s.minutes || entry.time < previousTime
      || entry.coinsPaid !== offer.coinsPaid || entry.coinsReceived !== offer.coinsReceived) return false;
    previousId = entry.logId; previousTime = entry.time;
    events.push({ kind: "trade", logId: entry.logId, time: entry.time, actorId: entry.actorId,
      coinsPaid: entry.coinsPaid, coinsReceived: entry.coinsReceived });
  }
  previousId = 0; previousTime = -1;
  for (const entry of s.currency?.transfers ?? []) {
    if (!record(entry) || !whole(entry.logId, 1) || entry.logId >= s.nextId || entry.logId <= previousId
      || !whole(entry.time) || entry.time > s.minutes || entry.time < previousTime
      || typeof entry.from !== "string" || typeof entry.to !== "string" || entry.from === entry.to
      || !ids.has(entry.from) || !ids.has(entry.to) || !ids.has(entry.actorId)
      || (entry.actorId !== entry.from && entry.actorId !== entry.to) || !whole(entry.amount, 1)) return false;
    previousId = entry.logId; previousTime = entry.time;
    events.push({ kind: "transfer", logId: entry.logId, time: entry.time, from: entry.from, to: entry.to, amount: entry.amount });
  }
  const wallets = new Map<string, number>(), cashByDay = new Map<number, number>();
  const change = (id: string, delta: number): boolean => {
    const next = (wallets.get(id) ?? 0) + delta;
    if (!whole(next)) return false;
    wallets.set(id, next); return true;
  };
  previousId = 0; previousTime = -1;
  for (const event of events.sort((a, b) => a.logId - b.logId)) {
    if (event.logId <= previousId || event.time < previousTime) return false;
    previousId = event.logId; previousTime = event.time;
    if (event.kind === "transfer") {
      if (!change(event.from, -event.amount) || !change(event.to, event.amount)) return false;
    } else {
      if (!change(event.actorId, event.coinsReceived - event.coinsPaid)) return false;
      const day = Math.floor(event.time / 1440), cash = (cashByDay.get(day) ?? VILLAGE_DAILY_CASH) + event.coinsPaid - event.coinsReceived;
      if (!whole(cash)) return false;
      cashByDay.set(day, cash);
    }
  }
  return true;
}

/** New transfers and work markers are paired independently of the wording of a log. */
export function validCurrencyState(s: GameState, knownLocations: readonly string[]): boolean {
  if (!Array.isArray(s.logs) || !Array.isArray(s.residents) || !validCurrencyLedger(s)) return false;
  if (s.currency !== undefined && (!record(s.currency) || Object.keys(s.currency).some((k) => k !== "version" && k !== "transfers"))) return false;
  const ids = new Set(s.residents.filter((r) => record(r)).map((r) => r.id));
  const used = new Set<number>();
  for (const entry of s.currency?.transfers ?? []) {
    if (!record(entry) || Object.keys(entry).length !== 7
      || !Object.keys(entry).every((k) => ["logId", "time", "location", "actorId", "from", "to", "amount"].includes(k))
      || typeof entry.location !== "string" || !knownLocations.includes(entry.location)) return false;
    const matches = s.logs.filter((log) => log?.id === entry.logId), log = matches[0];
    if (matches.length !== 1 || log.type !== "work" || log.time !== entry.time || "coinTrade" in log
      || !Array.isArray(log.actors) || log.actors.length !== 1 || log.actors[0] !== entry.actorId
      || !Array.isArray(log.witnesses) || !log.witnesses.includes(entry.actorId)
      || new Set(log.witnesses).size !== log.witnesses.length || log.witnesses.some((id) => !ids.has(id))
      || !record(log.coinTransfer) || Object.keys(log.coinTransfer).length !== 4
      || log.coinTransfer.from !== entry.from || log.coinTransfer.to !== entry.to
      || log.coinTransfer.amount !== entry.amount || log.coinTransfer.location !== entry.location) return false;
    used.add(entry.logId);
  }
  for (const log of s.logs) if (record(log) && "coinTransfer" in log) {
    if ("coinTrade" in log || !used.has(log.id)) return false;
  }
  return true;
}
