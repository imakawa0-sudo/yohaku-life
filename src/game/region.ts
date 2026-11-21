import { getPresentEncounterAt } from "./encounters";
import type { GameState, Location, LocationId, Resident, Resources } from "./types";
import { ensureInventory, ownFreeResources } from "./inventory";
import { getWalletCoins, getVillageCash, isCoinChoice, VILLAGE_COINS_TERMS_ID, VILLAGE_COIN_OFFERS, validCurrencyLedger, type CoinChoice } from "./currency";
export { isCoinChoice } from "./currency";

export type HarvestLocation = "meadow" | "reedbank";
export const HARVEST_SITES = {
  meadow: { minutes: 30, name: "川沿い", ingredients: 3, scrap: 1 },
  reedbank: { minutes: 35, name: "上流の葦原", ingredients: 4, scrap: 2 },
} as const;
export function isHarvestLocation(location: unknown): location is HarvestLocation {
  return typeof location === "string" && Object.hasOwn(HARVEST_SITES, location);
}

export type LegacyRegionChoice = "talk" | "trade-food" | "trade-medicine" | "deliver";
export const AGREEMENT_FOOD_TERMS_ID = "village-agreement-food-v1" as const;
type BarterTermsId = "village-barter-v1" | typeof AGREEMENT_FOOD_TERMS_ID;
export type RegionChoice = LegacyRegionChoice | CoinChoice | "report-agreement";
export type VillageTermsId = BarterTermsId | typeof VILLAGE_COINS_TERMS_ID;
type VillageNpcId = "village-trader" | "village-guide";
export type RegionNpcId = VillageNpcId | "lodge-keeper";
export type RegionNPC = {
  id: RegionNpcId;
  name: string;
  role: string;
  description: string;
  location: LocationId;
};
type RegionReceiptBase = {
  actorId: string;
  npcId: VillageNpcId;
  time: number;
  paid: Partial<Resources>;
  received: Partial<Resources>;
  trustGain: number;
};
export type CoinRegionReceipt = RegionReceiptBase & {
  choice: CoinChoice;
  termsId: typeof VILLAGE_COINS_TERMS_ID;
  coinsPaid: number;
  coinsReceived: number;
  logId: number;
};
export type RegionReceipt = CoinRegionReceipt | (RegionReceiptBase & {
  choice: LegacyRegionChoice;
  /** Missing on older barter means village-barter-v1. */
  termsId?: BarterTermsId;
  coinsPaid?: never;
  coinsReceived?: never;
  logId?: never;
}) | (RegionReceiptBase & {
  choice: "report-agreement";
  logId: number;
  termsId?: never;
  coinsPaid?: never;
  coinsReceived?: never;
});
export type RegionState = {
  version: 1;
  stockDay: number;
  stock: { food: number; medicine: number };
  trust: Record<VillageNpcId, Record<string, number>>;
  talked: Record<VillageNpcId, string[]>;
  /** Map-level discovery; routeKnownBy retains who actually heard the guide. */
  knownRoute: boolean;
  routeKnownBy: string[];
  request?: { deliveredBy: string; time: number };
  harvests: { actorId: string; day: number; time: number; location?: HarvestLocation }[];
  receipts: RegionReceipt[];
  /** Optional in older saves; each entry is the actual household joining event. */
  recruitments?: { residentId: string; invitedBy: string; time: number; logId: number }[];
};
export type RegionPreview = {
  npcId: string;
  choice: RegionChoice;
  title: string;
  text: string;
  paid: Partial<Resources>;
  received: Partial<Resources>;
  trustGain: number;
  termsId?: VillageTermsId;
  coinsPaid?: number;
  coinsReceived?: number;
  walletBefore?: number;
  walletAfter?: number;
  villageCashBefore?: number;
  villageCashAfter?: number;
  knownRoute?: boolean;
  stock?: { food: number; medicine: number };
  error?: string;
};

export const REGION_LOCATIONS: Record<"village" | "meadow" | "ridge" | "reedbank" | "lodge", Location> = {
  village: {
    id: "village", name: "近隣の集落", kind: "wild",
    description: "小さな店と道案内の腰掛け、雨よけの休み所がある集落。持ち寄った品や、道の話を交換できる。",
    connections: ["meadow", "ridge", "reedbank"],
  },
  meadow: {
    id: "meadow", name: "川沿いの採集地", kind: "wild",
    description: "川辺には食べられる草と、流れ着いた小さな資材がある。採った跡が戻るまで、次の収穫は待とう。",
    connections: ["road", "village"],
  },
  ridge: {
    id: "ridge", name: "尾根の近道", kind: "wild",
    description: "集落と旧い資材置き場を結ぶ細道。距離は短いが、置き場の人影を避けて通れるとは限らない。",
    connections: ["ruins", "village"],
  },
  reedbank: {
    id: "reedbank", name: "上流の葦原", kind: "wild",
    description: "上流の浅瀬には食用の根と丈夫な葦が育つ。集落へ戻る水辺の道と、舟宿の工房への小道が交わる。",
    connections: ["village", "lodge"],
  },
  lodge: {
    id: "lodge", name: "舟宿の工房", kind: "wild",
    description: "舟宿の板間には鍋と作業台、寝床がある。物置に置いた荷はこの舟宿に残り、再び訪れた人が使える。",
    connections: ["reedbank"],
  },
};

const VILLAGE_NPCS: readonly (RegionNPC & { id: VillageNpcId })[] = [
  { id: "village-trader", name: "集落の商い手", role: "食料と手当用品の交換",
    description: "持ち込んだ資材を、今日使う食事や手当用品と交換してくれる。品数は一日分だけ。", location: "village" },
  { id: "village-guide", name: "道を知る住民", role: "道の話と、小さな頼みごと",
    description: "近道と川辺の様子を知っている。皆で分ける食事を三食、届けてもらえないかと頼んでいる。", location: "village" },
];

export const LODGE_KEEPER = {
  id: "lodge-keeper", name: "舟宿番のナギ", role: "舟と宿の手入れ", location: "lodge",
  description: "ナギは縄を綯いながら昼の食卓を預かっている。「ここで何日か食べていった人なら、同じ屋根で暮らす話もできるね」",
} as const satisfies RegionNPC;
export const REGION_NPCS: readonly RegionNPC[] = [...VILLAGE_NPCS, LODGE_KEEPER];

const KEYS = ["food", "ingredients", "medicine", "scrap"] as const;
const VILLAGE_NPC_IDS = VILLAGE_NPCS.map((npc) => npc.id);
const dayOf = (minutes: number) => Math.floor(minutes / 1440) + 1;
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const whole = (value: unknown, min = 0): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= min;

export function createRegionState(s?: Pick<GameState, "minutes">): RegionState {
  return {
    version: 1,
    stockDay: dayOf(s?.minutes ?? 480),
    stock: { food: 6, medicine: 3 },
    trust: { "village-trader": {}, "village-guide": {} },
    talked: { "village-trader": [], "village-guide": [] },
    knownRoute: false,
    routeKnownBy: [],
    harvests: [],
    receipts: [],
  };
}

export function regionEdgeMinutes(from: LocationId, to: LocationId): number | undefined {
  const key = [from, to].sort().join(":");
  return ({ "meadow:road": 18, "meadow:village": 18, "ridge:ruins": 8, "ridge:village": 10, "reedbank:village": 32, "lodge:reedbank": 12 } as Record<string, number>)[key];
}

export function regionShopOpen(minutes: number): boolean {
  const minute = minutes % 1440;
  return minute >= 480 && minute < 1080;
}

/** Reading opening hours never creates or replenishes saved state. */
export function regionNPCsAt(s: GameState, location: LocationId): RegionNPC[] {
  if (!regionShopOpen(s.minutes)) return [];
  return REGION_NPCS.filter((npc) => npc.location === location
    && !s.residents.some((resident) => resident.id === npc.id)).map((npc) => ({ ...npc }));
}

/** Read-only availability for the landscape and the action preview. */
export function regionHarvestAvailable(s: GameState, location: HarvestLocation = "meadow"): boolean {
  return !s.region?.harvests.some((entry) => entry.day === dayOf(s.minutes) && (entry.location ?? "meadow") === location);
}

export function getVillageStock(s: GameState): { food: number; medicine: number } {
  return s.region?.stockDay === dayOf(s.minutes)
    ? { ...s.region.stock } : { food: 6, medicine: 3 };
}

type BarterCost = { paid: Partial<Resources>; received: Partial<Resources> };
const LEGACY_VILLAGE_OFFERS = Object.freeze({
  "trade-food": Object.freeze({ paid: Object.freeze({ scrap: 2 }), received: Object.freeze({ food: 3 }) }),
  "trade-medicine": Object.freeze({ paid: Object.freeze({ scrap: 1 }), received: Object.freeze({ medicine: 1 }) }),
});
const AGREEMENT_FOOD_OFFER = Object.freeze({ paid: Object.freeze({ scrap: 1 }), received: Object.freeze({ food: 3 }) });
export function hasReportedGuardAgreement(s: GameState, residentId: string): boolean {
  return s.guardAgreement?.actorId === residentId
    && !!s.region?.receipts.some(entry => entry.choice === "report-agreement" && entry.actorId === residentId);
}
function villageBarterTerms(s: GameState, residentId: string, choice: "trade-food" | "trade-medicine"): BarterTermsId {
  if (choice === "trade-food" && hasReportedGuardAgreement(s, residentId)
    && !s.region!.receipts.some(entry => entry.termsId === AGREEMENT_FOOD_TERMS_ID && dayOf(entry.time) === dayOf(s.minutes)))
    return AGREEMENT_FOOD_TERMS_ID;
  return "village-barter-v1";
}
function isBarter(choice: RegionChoice): choice is "trade-food" | "trade-medicine" {
  return choice === "trade-food" || choice === "trade-medicine";
}
function costFor(choice: RegionChoice, termsId?: unknown): BarterCost | undefined {
  if (isCoinChoice(choice)) return termsId === VILLAGE_COINS_TERMS_ID ? VILLAGE_COIN_OFFERS[choice] : undefined;
  if (isBarter(choice)) {
    if (termsId === AGREEMENT_FOOD_TERMS_ID) return choice === "trade-food" ? AGREEMENT_FOOD_OFFER : undefined;
    return termsId === undefined || termsId === "village-barter-v1" ? LEGACY_VILLAGE_OFFERS[choice] : undefined;
  }
  if (choice === "deliver") return { paid: { food: 3 }, received: { medicine: 2 } };
  return { paid: {}, received: {} };
}

export function villageContactProblem(s: GameState, actor: Resident, npc: RegionNPC): string | undefined {
  if (s.ended) return "この試行は終了しています。保存から再開してください。";
  if (actor.location !== npc.location) return `${actor.name}を近隣の集落へ移動してから話してください。`;
  if (!regionNPCsAt(s, actor.location).some((person) => person.id === npc.id)) return "集落で話せるのは08:00から18:00までです。";
  if (actor.hp <= 0 || actor.action?.kind === "sleep") return `${actor.name}は今、やりとりに応じられません。`;
  if ([actor.action, actor.suspended].some((action) => action && ["move", "rescue", "attack", "defend"].includes(action.kind)))
    return "移動・救助・交戦の指示を終えるか、取り消してから話してください。";
  if (s.residents.some((person) => person.hp > 0 && person.location === actor.location && actor.hp <= 35 && person.action?.kind === "rescue" && person.action.target === actor.id))
    return "運ばれている住民は、今はやりとりできません。";
  if ((getPresentEncounterAt(s, actor.location)?.hp ?? 0) > 0) return "交戦の現場では、やりとりできません。";
}

export function inspectRegionInteraction(s: GameState, residentId: string, npcId: string, choice: RegionChoice): RegionPreview {
  const termsId = isCoinChoice(choice) ? VILLAGE_COINS_TERMS_ID : isBarter(choice) ? villageBarterTerms(s, residentId, choice) : undefined;
  const costs = costFor(choice, termsId)!;
  const titles: Record<RegionChoice, string> = {
    talk: "話を聞く", "report-agreement": "置き場の合意を伝える",
    "trade-food": termsId === AGREEMENT_FOOD_TERMS_ID ? "道の礼に、資材1個を食事3食に交換" : "資材2個を食事3食に交換",
    "trade-medicine": "資材1個を手当用品1個に交換", deliver: "食事3食を届ける",
    "sell-scrap": "資材1個を売って銀貨2枚", "buy-food": "銀貨4枚で食事3食を買う", "buy-medicine": "銀貨2枚で手当用品1個を買う",
  };
  const result: RegionPreview = { npcId, choice, title: titles[choice] ?? "集落でのやりとり", text: "", paid: { ...costs.paid }, received: { ...costs.received }, trustGain: 0,
    ...(termsId ? { termsId } : {}) };
  if (isCoinChoice(choice)) {
    const offer = VILLAGE_COIN_OFFERS[choice];
    result.coinsPaid = offer.coinsPaid;
    result.coinsReceived = offer.coinsReceived;
    result.walletBefore = getWalletCoins(s, residentId);
    result.walletAfter = result.walletBefore + offer.coinsReceived - offer.coinsPaid;
    result.villageCashBefore = getVillageCash(s);
    result.villageCashAfter = result.villageCashBefore + offer.coinsPaid - offer.coinsReceived;
    result.stock = getVillageStock(s);
  }
  const fail = (error: string): RegionPreview => ({ ...result, error });
  if (!["talk", "trade-food", "trade-medicine", "deliver", "report-agreement"].includes(choice) && !isCoinChoice(choice)) return fail("行うことを選んでください。");
  const npc = VILLAGE_NPCS.find((person) => person.id === npcId);
  if (!npc) return fail("話す相手が見つかりません。");
  const actor = s.residents.find((person) => person.id === residentId);
  if (!actor) return fail("行動する住民を一人選んでください。");
  const contact = villageContactProblem(s, actor, npc);
  if (contact) return fail(contact);
  if (choice === "report-agreement") {
    if (npc.id !== "village-trader") return fail("置き場の話を待っているのは集落の商い手です。");
    if (s.guardAgreement?.actorId !== actor.id) return fail("食事を渡して守り手と話をつけた本人が、商い手に伝えられます。");
    if (hasReportedGuardAgreement(s, actor.id)) return fail("商い手はもうこの合意を聞いています。");
    if (!Number.isSafeInteger(s.nextId) || s.nextId >= Number.MAX_SAFE_INTEGER) return fail("会話を記録する番号が足りません。");
    result.trustGain = 1;
    result.text = `${actor.name}は、守り手に食事を渡して置き場を譲り受けたことを話した。「あの道を通れるなら荷運びも助かるよ。あんたには一日一度、資材ひとつで食事を三つ包もう」。商い手との信用が増えた。`;
    return result;
  }
  if (choice === "talk") {
    if (s.region?.talked[npc.id].includes(actor.id)) return fail("この話はすでに聞いています。得た情報は記録から読み返せます。");
    result.trustGain = 1;
    result.knownRoute = npc.id === "village-guide";
    result.text = npc.id === "village-guide"
      ? `${actor.name}は、尾根の近道が旧い資材置き場を通ると聞いた。川沿いの道は少し遠いが、置き場を避けられる。次の外出で使える道順を覚えた。`
      : `${actor.name}は、資材を食事や手当用品と交換できると聞いた。店の品は一日分で、旅先では持ってきた品だけを渡せる。`;
    return result;
  }
  if (npc.id === "village-guide" && choice !== "deliver") return fail("この住民とは、道の話か食事の届け物を選べます。");
  if (npc.id === "village-trader" && choice === "deliver") return fail("食事の届け先は、道を知る住民です。");
  if (choice === "deliver" && s.region?.request) return fail("食事はすでに届けられています。この頼みごとの受取りは一度だけです。");
  if (isCoinChoice(choice)) {
    if (!whole(result.walletAfter)) return fail("本人の所持銀貨が足りません。売って得た銀貨は、本人だけが使えます。");
    if (!whole(result.villageCashAfter)) return fail("店の買取資金が足りません。今日の買物で戻る銀貨か、翌日の予算を待てます。");
  }
  const free = ownFreeResources(s, actor.id);
  if (KEYS.some((key) => free[key] < (result.paid[key] ?? 0))) return fail("本人の未予約の携行品が足りません。拠点や別の仲間の品を、離れたまま渡すことはできません。");
  if (npc.id === "village-trader") {
    result.stock = getVillageStock(s);
    if ((result.stock.food < (result.received.food ?? 0)) || (result.stock.medicine < (result.received.medicine ?? 0))) return fail("その品は本日の分が売り切れています。別の用事や帰還を選べます。");
  }
  if (isCoinChoice(choice)) {
    result.text = choice === "sell-scrap"
      ? `${actor.name}が携えてきた資材1個を売り、銀貨2枚を受け取った。銀貨は本人が持っている。`
      : choice === "buy-food"
      ? `${actor.name}が本人の銀貨4枚を払い、食事3食を荷物に収めた。`
      : `${actor.name}が本人の銀貨2枚を払い、手当用品1個を荷物に収めた。`;
  } else if (choice === "deliver") {
    result.trustGain = 2;
    result.text = `${actor.name}が携えてきた食事3食を届け、手当用品2個を受け取った。道を知る住民との信用が増えた。頼みごとはこれで完了した。`;
  } else {
    result.text = choice === "trade-food"
      ? (termsId === AGREEMENT_FOOD_TERMS_ID
        ? `${actor.name}が資材1個を渡すと、商い手は道を開いてくれた礼に食事3食を包んだ。`
        : `${actor.name}が携えてきた資材2個を渡し、食事3食を受け取った。`)
      : `${actor.name}が携えてきた資材1個を渡し、手当用品1個を受け取った。`;
  }
  return result;
}

/** Applies to a staged game without clock/seed/id advance. The engine then binds a coin receipt to its real structured log. */
export function applyRegionInteraction(s: GameState, residentId: string, npcId: string, choice: RegionChoice): RegionPreview {
  const preview = inspectRegionInteraction(s, residentId, npcId, choice);
  if (preview.error) return preview;
  const npc = VILLAGE_NPCS.find((person) => person.id === npcId)!;
  const state = s.region ?? createRegionState(s);
  // The complete preview above precedes all writes, including lazy initialization.
  if (choice !== "talk" && choice !== "report-agreement") {
    const pack = ensureInventory(s).packs[residentId];
    for (const key of KEYS) pack[key] += (preview.received[key] ?? 0) - (preview.paid[key] ?? 0);
  }
  if (state.stockDay !== dayOf(s.minutes)) {
    state.stockDay = dayOf(s.minutes);
    state.stock = { food: 6, medicine: 3 };
  }
  if (npc.id === "village-trader" && choice !== "talk" && choice !== "report-agreement") {
    state.stock.food -= preview.received.food ?? 0;
    state.stock.medicine -= preview.received.medicine ?? 0;
  }
  if (choice === "talk") state.talked[npc.id].push(residentId);
  state.trust[npc.id][residentId] = (state.trust[npc.id][residentId] ?? 0) + preview.trustGain;
  if (preview.knownRoute) {
    state.knownRoute = true;
    if (!state.routeKnownBy.includes(residentId)) state.routeKnownBy.push(residentId);
  }
  if (choice === "deliver") state.request = { deliveredBy: residentId, time: s.minutes };
  const receipt = { actorId: residentId, npcId: npc.id, time: s.minutes, choice,
    paid: { ...preview.paid }, received: { ...preview.received }, trustGain: preview.trustGain };
  if (isCoinChoice(choice)) state.receipts.push({ ...receipt, choice, termsId: VILLAGE_COINS_TERMS_ID,
    coinsPaid: preview.coinsPaid!, coinsReceived: preview.coinsReceived!, logId: 0 });
  else if (choice === "report-agreement") state.receipts.push({ ...receipt, choice, logId: 0 });
  else state.receipts.push({ ...receipt, choice, ...(isBarter(choice) ? { termsId: preview.termsId as BarterTermsId } : {}) });
  s.region = state;
  return preview;
}

/** The engine adds this result at the real completer's location, exactly once. */
export function regionHarvest(s: GameState, actorId: string): { received?: Partial<Resources>; error?: string } {
  const actor = s.residents.find((person) => person.id === actorId);
  if (!actor || !isHarvestLocation(actor.location) || actor.hp <= 0) return { error: "採集を終えた住民が採集地にいません。" };
  if ((getPresentEncounterAt(s, actor.location)?.hp ?? 0) > 0) return { error: "危険がある間は採集を完了できません。" };
  const day = dayOf(s.minutes);
  if (!regionHarvestAvailable(s, actor.location)) return { error: "今日はもう採集しました。次の収穫は翌日です。" };
  const state = s.region ?? createRegionState(s);
  state.harvests.push({ actorId, day, time: s.minutes, ...(actor.location === "reedbank" ? { location: actor.location } : {}) });
  s.region = state;
  const { ingredients, scrap } = HARVEST_SITES[actor.location];
  return { received: { ingredients, scrap } };
}

/** Structural and accounting validation; historical receipts never depend on today's pack contents. */
export function validRegion(s: GameState): boolean {
  if (!Array.isArray(s.logs) || !validCurrencyLedger(s)) return false;
  const markedLogs = s.logs.filter((log) => record(log) && "coinTrade" in log);
  const reportLogs = s.logs.filter(log => record(log) && "reportedGuardAgreementId" in log);
  if (s.region === undefined) return markedLogs.length === 0 && reportLogs.length === 0;
  const r = s.region as unknown;
  if (!record(r) || r.version !== 1 || !whole(r.stockDay, 1) || r.stockDay > dayOf(s.minutes)
    || !record(r.stock) || Object.keys(r.stock).some((key) => !["food", "medicine"].includes(key))
    || !whole(r.stock.food) || r.stock.food > 6 || !whole(r.stock.medicine) || r.stock.medicine > 3
    || !record(r.trust) || !record(r.talked) || typeof r.knownRoute !== "boolean"
    || !Array.isArray(r.routeKnownBy) || !Array.isArray(r.harvests) || !Array.isArray(r.receipts)) return false;
  const ids = new Set(s.residents.map((person) => person.id));
  if (r.recruitments !== undefined) {
    if (!Array.isArray(r.recruitments)) return false;
    const recruited = new Set<string>(), joiningLogs = new Set<number>();
    for (const entry of r.recruitments) {
      if (!record(entry) || typeof entry.residentId !== "string" || !REGION_NPCS.some(npc => npc.id === entry.residentId)
        || !ids.has(entry.residentId) || typeof entry.invitedBy !== "string" || !ids.has(entry.invitedBy)
        || entry.invitedBy === entry.residentId || !whole(entry.time) || entry.time > s.minutes
        || !whole(entry.logId, 1) || entry.logId >= s.nextId
        || recruited.has(entry.residentId) || joiningLogs.has(entry.logId)) return false;
      recruited.add(entry.residentId);
      joiningLogs.add(entry.logId);
    }
  }
  if (Object.keys(r.trust).some((key) => !VILLAGE_NPC_IDS.includes(key as VillageNpcId))
    || Object.keys(r.talked).some((key) => !VILLAGE_NPC_IDS.includes(key as VillageNpcId))) return false;
  const idArray = (values: unknown): values is string[] => Array.isArray(values)
    && values.every((id) => typeof id === "string" && ids.has(id)) && new Set(values).size === values.length;
  if (!idArray(r.routeKnownBy)) return false;
  const receivedTrust: Record<VillageNpcId, Record<string, number>> = { "village-trader": {}, "village-guide": {} };
  const talked: Record<VillageNpcId, string[]> = { "village-trader": [], "village-guide": [] };
  const spent = { food: 0, medicine: 0 };
  const soldByDay = new Map<number, { food: number; medicine: number }>();
  let lastCoinLogId = 0;
  const usedCoinLogs = new Set<number>();
  let lastReceiptTime = -1;
  let reported = false;
  let lastDiscountDay = 0;
  let delivery: { deliveredBy: string; time: number } | undefined;
  const validAmounts = (value: unknown): value is Partial<Resources> => record(value)
    && Object.keys(value).every((key) => KEYS.includes(key as keyof Resources) && whole(value[key]));
  const equalAmounts = (a: Partial<Resources>, b: Partial<Resources>) => KEYS.every((key) => (a[key] ?? 0) === (b[key] ?? 0));
  for (const entry of r.receipts) {
    if (!record(entry) || typeof entry.actorId !== "string" || !ids.has(entry.actorId)
      || entry.actorId === entry.npcId
      || !VILLAGE_NPC_IDS.includes(entry.npcId as VillageNpcId) || !whole(entry.time) || entry.time > s.minutes
      || entry.time % 1440 < 480 || entry.time % 1440 >= 1080
      || (!["talk", "trade-food", "trade-medicine", "deliver", "report-agreement"].includes(entry.choice as string) && !isCoinChoice(entry.choice))
      || "from" in entry || "to" in entry || "amount" in entry || "location" in entry || "coinTransfer" in entry
      || !validAmounts(entry.paid) || !validAmounts(entry.received) || !whole(entry.trustGain)) return false;
    if (entry.time < lastReceiptTime || dayOf(entry.time) > r.stockDay) return false;
    lastReceiptTime = entry.time;
    const choice = entry.choice as RegionChoice, npcId = entry.npcId as VillageNpcId;
    if (isCoinChoice(choice)) {
      const offer = VILLAGE_COIN_OFFERS[choice];
      if (npcId !== "village-trader" || entry.termsId !== VILLAGE_COINS_TERMS_ID
        || !whole(entry.coinsPaid) || !whole(entry.coinsReceived)
        || entry.coinsPaid !== offer.coinsPaid || entry.coinsReceived !== offer.coinsReceived
        || !whole(entry.logId, 1) || entry.logId >= s.nextId || entry.logId <= lastCoinLogId) return false;
      const logs = s.logs.filter((log) => log?.id === entry.logId);
      const log = logs[0];
      if (logs.length !== 1 || log.time !== entry.time || log.type !== "social" || "coinTransfer" in log
        || !Array.isArray(log.actors) || log.actors.length !== 2 || !log.actors.includes(entry.actorId) || !log.actors.includes(npcId)
        || !Array.isArray(log.witnesses) || !log.witnesses.includes(entry.actorId) || !log.witnesses.includes(npcId)
        || !record(log.coinTrade) || Object.keys(log.coinTrade).length !== 2
        || log.coinTrade.termsId !== VILLAGE_COINS_TERMS_ID || log.coinTrade.choice !== choice) return false;
      lastCoinLogId = entry.logId;
      usedCoinLogs.add(entry.logId);
    } else if (choice === "report-agreement") {
      const agreement = s.guardAgreement;
      const log = reportLogs[0];
      if (reported || !agreement || npcId !== "village-trader" || agreement.actorId !== entry.actorId
        || entry.time < agreement.agreedAt || !whole(entry.logId, 1) || entry.logId <= agreement.logId || entry.logId >= s.nextId
        || "coinsPaid" in entry || "coinsReceived" in entry || "termsId" in entry
        || reportLogs.length !== 1 || !log || log.id !== entry.logId || log.time !== entry.time || log.type !== "social"
        || s.logs.filter(other => other?.id === log.id).length !== 1 || log.reportedGuardAgreementId !== agreement.logId
        || "coinTrade" in log || "coinTransfer" in log || "guardAgreement" in log || "encounter" in log || "routeWork" in log
        || !Array.isArray(log.actors) || log.actors.length !== 2 || !log.actors.includes(entry.actorId) || !log.actors.includes(npcId)
        || !Array.isArray(log.witnesses) || !log.witnesses.includes(entry.actorId) || !log.witnesses.includes(npcId)
        || new Set(log.witnesses).size !== log.witnesses.length || log.witnesses.some(id => id !== npcId && !ids.has(id))) return false;
      reported = true;
    } else if ("coinsPaid" in entry || "coinsReceived" in entry || "logId" in entry
      || (!isBarter(choice) && entry.termsId !== undefined)) return false;
    if (choice === "trade-food") {
      const day = dayOf(entry.time);
      const earnedDiscount = reported && entry.actorId === s.guardAgreement?.actorId && lastDiscountDay !== day;
      if (earnedDiscount !== (entry.termsId === AGREEMENT_FOOD_TERMS_ID)) return false;
      if (earnedDiscount) lastDiscountDay = day;
    }
    const expected = costFor(choice, entry.termsId);
    if (!expected || !equalAmounts(entry.paid, expected.paid) || !equalAmounts(entry.received, expected.received)
      || entry.trustGain !== (choice === "talk" || choice === "report-agreement" ? 1 : choice === "deliver" ? 2 : 0)
      || (npcId === "village-guide" && choice !== "talk" && choice !== "deliver")
      || (npcId === "village-trader" && choice === "deliver")) return false;
    if (choice === "talk") {
      if (talked[npcId].includes(entry.actorId)) return false;
      talked[npcId].push(entry.actorId);
    }
    if (choice === "deliver") {
      if (delivery) return false;
      delivery = { deliveredBy: entry.actorId, time: entry.time };
    }
    receivedTrust[npcId][entry.actorId] = (receivedTrust[npcId][entry.actorId] ?? 0) + entry.trustGain;
    if (npcId === "village-trader" && dayOf(entry.time) === r.stockDay) {
      spent.food += entry.received.food ?? 0;
      spent.medicine += entry.received.medicine ?? 0;
    }
    if (npcId === "village-trader") {
      const day = dayOf(entry.time), sold = soldByDay.get(day) ?? { food: 0, medicine: 0 };
      sold.food += entry.received.food ?? 0;
      sold.medicine += entry.received.medicine ?? 0;
      if (sold.food > 6 || sold.medicine > 3) return false;
      soldByDay.set(day, sold);
    }
  }
  if (markedLogs.some((log) => !usedCoinLogs.has(log.id)) || reportLogs.length !== Number(reported)) return false;
  if (r.stock.food !== 6 - spent.food || r.stock.medicine !== 3 - spent.medicine) return false;
  for (const npcId of VILLAGE_NPC_IDS) {
    const actualTrust = r.trust[npcId];
    if (!record(actualTrust) || Object.keys(actualTrust).some((id) => !ids.has(id)) || !idArray(r.talked[npcId])) return false;
    for (const id of ids) if ((actualTrust[id] ?? 0) !== (receivedTrust[npcId][id] ?? 0)) return false;
    if ((r.talked[npcId] as string[]).length !== talked[npcId].length
      || !(r.talked[npcId] as string[]).every((id) => talked[npcId].includes(id))) return false;
  }
  if (r.knownRoute !== (talked["village-guide"].length > 0)
    || r.routeKnownBy.length !== talked["village-guide"].length
    || !r.routeKnownBy.every((id) => talked["village-guide"].includes(id))) return false;
  if (delivery) {
    if (!record(r.request) || r.request.deliveredBy !== delivery.deliveredBy || r.request.time !== delivery.time) return false;
  } else if (r.request !== undefined) return false;
  const harvestedDays = new Set<string>();
  for (const harvest of r.harvests) {
    if (!record(harvest) || typeof harvest.actorId !== "string" || !ids.has(harvest.actorId)
      || !whole(harvest.day, 1) || !whole(harvest.time) || harvest.time > s.minutes
      || dayOf(harvest.time) !== harvest.day
      || (harvest.location !== undefined && !isHarvestLocation(harvest.location))) return false;
    const key = `${harvest.day}:${harvest.location ?? "meadow"}`;
    if (harvestedDays.has(key)) return false;
    harvestedDays.add(key);
  }
  return true;
}
