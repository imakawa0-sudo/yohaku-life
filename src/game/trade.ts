import { getPresentEncounterAt } from "./encounters";
import type { GameState, MerchantTermsId, Resources, TradeOfferId, TradeState } from "./types";
export type { TradeOfferId, TradeReceipt, TradeState, MerchantVisit } from "./types";
export type TradeOffer = {
  id: TradeOfferId; title: string; paid: Partial<Resources>; received: Partial<Resources>; stockKey: "scrap" | "medicine";
};
export type MerchantStatus = {
  location: "home"; status: "upcoming" | "open" | "departed";
  arrivesAt: number; leavesAt: number; nextArrival: number;
  visitId?: number; stock?: { scrap: number; medicine: number };
};
export type TradePreview = {
  actorId?: string; before: Resources; after?: Resources; reserved: Resources;
  paid: Partial<Resources>; received: Partial<Resources>;
  termsId?: MerchantTermsId;
  error?: string; warning?: string; confirmationKey?: string;
};
export type TradeIntent = { allowLowFood?: boolean; confirmationKey?: string };
const KEYS = ["food", "ingredients", "medicine", "scrap"] as const;
const LEGACY_MERCHANT_OFFERS: readonly TradeOffer[] = Object.freeze([
  { id: "meal-for-scrap", title: "食事で資材を受け取る", paid: { food: 2 }, received: { scrap: 1 }, stockKey: "scrap" },
  { id: "ingredients-for-scrap", title: "食材で資材を受け取る", paid: { ingredients: 3 }, received: { scrap: 1 }, stockKey: "scrap" },
  { id: "meal-for-medicine", title: "食事で手当用品を受け取る", paid: { food: 3 }, received: { medicine: 1 }, stockKey: "medicine" },
  { id: "ingredients-for-medicine", title: "食材で手当用品を受け取る", paid: { ingredients: 4 }, received: { medicine: 1 }, stockKey: "medicine" },
].map((offer) => Object.freeze({ ...offer, paid: Object.freeze(offer.paid), received: Object.freeze(offer.received) })) as TradeOffer[]);
/** Historical terms are immutable, independent of the terms selected for future visits. */
const MERCHANT_TERMS = Object.freeze({ "merchant-barter-v1": LEGACY_MERCHANT_OFFERS });
const CURRENT_MERCHANT_TERMS_ID: MerchantTermsId = "merchant-barter-v1";
function merchantOffersFor(termsId: unknown): readonly TradeOffer[] | undefined {
  if (termsId === undefined) return MERCHANT_TERMS["merchant-barter-v1"];
  return termsId === "merchant-barter-v1" ? MERCHANT_TERMS[termsId] : undefined;
}
export const TRADE_OFFERS: readonly TradeOffer[] = MERCHANT_TERMS[CURRENT_MERCHANT_TERMS_ID];
export function getTradeOffer(id: string): TradeOffer | undefined { return TRADE_OFFERS.find((offer) => offer.id === id); }
/** Reading a saved visit never replaces its terms or initializes a visit. */
export function getMerchantOffers(s: GameState): readonly TradeOffer[] {
  return merchantOffersFor(s.trade?.visit?.termsId) ?? [];
}
export function createTradeState(beforeAdvanceMinutes: number): TradeState {
  let noon = Math.floor(beforeAdvanceMinutes / 1440) * 1440 + 720;
  if (noon <= beforeAdvanceMinutes) noon += 1440;
  return { version: 1, nextArrival: Math.max(2160, noon), receipts: [] };
}
export function getMerchantStatus(s: GameState): MerchantStatus {
  const trade = s.trade ?? createTradeState(s.minutes);
  const visit = trade.visit;
  if (visit && visit.status === "open" && s.minutes >= visit.arrivesAt && s.minutes < visit.leavesAt)
    return { location: "home", status: "open", arrivesAt: visit.arrivesAt, leavesAt: visit.leavesAt,
      nextArrival: trade.nextArrival, visitId: visit.id, stock: { ...visit.stock } };
  if (visit && s.minutes >= visit.leavesAt && Math.floor(s.minutes / 1440) === Math.floor(visit.arrivesAt / 1440))
    return { location: "home", status: "departed", arrivesAt: visit.arrivesAt, leavesAt: visit.leavesAt,
      nextArrival: trade.nextArrival, visitId: visit.id, stock: { ...visit.stock } };
  return { location: "home", status: "upcoming", arrivesAt: trade.nextArrival, leavesAt: trade.nextArrival + 240, nextArrival: trade.nextArrival };
}
/** Only the engine's positive minute update calls this mutating transition. */
export function tickMerchant(s: GameState): { arrived: boolean; departed: boolean } {
  const trade = s.trade;
  if (!trade) return { arrived: false, departed: false };
  let departed = false, arrived = false;
  if (trade.visit?.status === "open" && s.minutes >= trade.visit.leavesAt) { trade.visit.status = "departed"; departed = true; }
  if (s.minutes === trade.nextArrival) {
    trade.visit = { id: s.minutes, arrivesAt: s.minutes, leavesAt: s.minutes + 240, status: "open", stock: { scrap: 3, medicine: 1 }, termsId: CURRENT_MERCHANT_TERMS_ID };
    trade.nextArrival += 1440; arrived = true;
  }
  return { arrived, departed };
}
/** Shared by the read-only engine preview and the actual atomic command. */
export function inspectTrade(s: GameState, ids: string[], visitId: number | undefined, offerId: string, free: Resources): TradePreview {
  const offer = getMerchantOffers(s).find((candidate) => candidate.id === offerId);
  const reserved = Object.fromEntries(KEYS.map((key) => [key, s.resources[key] - free[key]])) as Resources;
  const result: TradePreview = { before: { ...free }, reserved, paid: { ...offer?.paid }, received: { ...offer?.received } };
  if (offer) result.termsId = s.trade?.visit?.termsId ?? "merchant-barter-v1";
  if (offer && KEYS.every((key) => free[key] >= (offer.paid[key] ?? 0)))
    result.after = Object.fromEntries(KEYS.map((key) => [key, free[key] - (offer.paid[key] ?? 0) + (offer.received[key] ?? 0)])) as Resources;
  const fail = (error: string) => ({ ...result, error });
  if (!offer) return fail("交換する品が見つかりません。");
  if (s.ended) return fail("この試行は終了しています。保存から再開してください。");
  if (ids.length !== 1) return fail("交換する住民を、ホームの一覧で一人だけ選んでください。");
  const actor = s.residents.find((r) => r.id === ids[0]);
  if (!actor) return fail("交換する住民が見つかりません。");
  result.actorId = actor.id;
  const status = getMerchantStatus(s);
  if (status.status !== "open") return fail("今は行商と交換できません。次の来訪予定を確認してください。");
  if (visitId !== status.visitId) return fail("この来訪はすでに変わっています。現在の品と在庫を確認してください。");
  if (actor.hp <= 0 || actor.action?.kind === "sleep") return fail(`${actor.name}は今、交換に応じられません。起きている仲間を選んでください。`);
  if (actor.location !== "home") return fail(`${actor.name}を共同の居間へ移動してから交換してください。`);
  if (actor.action && ["move", "rescue", "attack", "defend"].includes(actor.action.kind)) return fail(`${actor.name}は移動・運搬・交戦中のため、交換できません。`);
  // Home is required above, so another person's old rescue claim cannot mean
  // this actor is still being transported outside. Own rescue jobs stay held.
  if ([actor.action, actor.suspended].some((a) => a?.kind === "rescue"))
    return fail(`${actor.name}は救助・運搬に関わっています。運搬を終えるか、指示を確認してください。`);
  if (getPresentEncounterAt(s, actor.location)) return fail(`${actor.name}は交戦の現場にいるため、交換できません。`);
  if (status.stock![offer.stockKey] < (offer.received[offer.stockKey] ?? 0)) return fail("その品は、本日の分が売り切れました。");
  if (!result.after) return fail("交換に必要な利用可能数がありません。予約中の食料は渡せません。");
  if (result.after.food < s.residents.length && result.after.ingredients < 2)
    result.warning = `交換後は利用可能な食事${result.after.food}食・食材${result.after.ingredients}個です。次の${s.residents.length === 3 ? "三人" : `${s.residents.length}人`}分の食事、または一回の調理材料に届きません。`;
  result.confirmationKey = JSON.stringify(["trade-v1", visitId, offerId, result.termsId, offer.paid, offer.received, actor.id, s.minutes,
    KEYS.map((key) => s.resources[key]), KEYS.map((key) => reserved[key]), status.stock!.scrap, status.stock!.medicine]);
  return result;
}

export function validTradeState(s: GameState): boolean {
  if (s.trade === undefined) return true;
  const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
  const integer = (v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max;
  const noon = (v: unknown): v is number => integer(v, 2160) && v % 1440 === 720;
  const trade = s.trade;
  if (!object(trade) || trade.version !== 1 || !noon(trade.nextArrival) || trade.nextArrival <= s.minutes || !Array.isArray(trade.receipts)) return false;
  const visit = trade.visit;
  if (visit !== undefined) {
    if (!object(visit) || !noon(visit.id) || visit.arrivesAt !== visit.id || visit.leavesAt !== visit.arrivesAt + 240
      || trade.nextArrival !== visit.arrivesAt + 1440 || !["open", "departed"].includes(visit.status)
      || !object(visit.stock) || Object.keys(visit.stock).some((key) => !["scrap", "medicine"].includes(key))
      || !merchantOffersFor(visit.termsId)
      || !integer(visit.stock.scrap, 0, 3) || !integer(visit.stock.medicine, 0, 1)) return false;
    if (visit.status === "open" ? !(s.minutes >= visit.arrivesAt && s.minutes < visit.leavesAt) : s.minutes < visit.leavesAt) return false;
  } else if (trade.receipts.length || trade.nextArrival !== createTradeState(s.minutes).nextArrival) return false;
  const ids = new Set(s.residents.map((r) => r.id));
  const used = new Set<number>(s.logs.map((log) => log.id));
  for (const r of s.residents) for (const action of [r.action, r.suspended]) if (action) {
    used.add(action.id); if (action.targetActionId !== undefined) used.add(action.targetActionId);
  }
  for (const value of Object.values(s.autonomy?.leisure ?? {})) used.add(value.actionId);
  for (const item of [...(s.life?.crafts ?? []), ...(s.life?.events ?? []), ...(s.life?.upgrades ?? [])]) used.add(item.id);
  const totals = new Map<number, { scrap: number; medicine: number }>();
  const amounts = (value: unknown, expected: Partial<Resources>) => object(value)
    && Object.keys(value).every((key) => KEYS.includes(key as typeof KEYS[number]))
    && KEYS.every((key) => (value[key] ?? 0) === (expected[key] ?? 0));
  for (const receipt of trade.receipts) {
    if (!object(receipt) || !integer(receipt.id, 1, s.nextId - 1) || used.has(receipt.id)
      || "coinsPaid" in receipt || "coinsReceived" in receipt || "logId" in receipt
      || "from" in receipt || "to" in receipt || "amount" in receipt || "location" in receipt || "coinTransfer" in receipt
      || !ids.has(receipt.actorId) || !noon(receipt.visitId) || !visit || receipt.visitId > visit.id
      || !integer(receipt.time, receipt.visitId, Math.min(s.minutes, receipt.visitId + 239))
      || (receipt.lowFoodConfirmed !== undefined && typeof receipt.lowFoodConfirmed !== "boolean")) return false;
    const offers = merchantOffersFor(receipt.termsId);
    if (!offers || (receipt.visitId === visit.id
      && (receipt.termsId ?? "merchant-barter-v1") !== (visit.termsId ?? "merchant-barter-v1"))) return false;
    const offer = offers.find((candidate) => candidate.id === receipt.offerId);
    if (!offer || !amounts(receipt.paid, offer.paid) || !amounts(receipt.received, offer.received)) return false;
    used.add(receipt.id);
    const total = totals.get(receipt.visitId) ?? { scrap: 0, medicine: 0 };
    total.scrap += offer.received.scrap ?? 0; total.medicine += offer.received.medicine ?? 0;
    if (total.scrap > 3 || total.medicine > 1) return false;
    totals.set(receipt.visitId, total);
  }
  if (visit) {
    const sold = totals.get(visit.id) ?? { scrap: 0, medicine: 0 };
    if (visit.stock.scrap !== 3 - sold.scrap || visit.stock.medicine !== 1 - sold.medicine) return false;
  }
  return true;
}
