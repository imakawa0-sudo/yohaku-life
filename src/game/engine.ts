import { applyVillageArt, validVillageArt } from "./village-art";
import { workSite } from "./types";
import { ensureInventory, freeBaseResources, ownFreeResources, accessibleResources, reserveActionResources, consumeActionResources, addResourcesAt, getCarryLoad, transferResources, inspectCoinTransfer, changeEquipment, validInventory, canShareAtCurrentLocation } from "./inventory";
import { isHarvestLocation, HARVEST_SITES, REGION_LOCATIONS, REGION_NPCS, createRegionState, regionEdgeMinutes, applyRegionInteraction, regionHarvest, regionHarvestAvailable, validRegion } from "./region";
import { normalizeTogetherMoves, snapshotTogetherSteps, refreshTogetherTravel, validTogetherMoves, type TogetherMovePreview } from "./together-move";
export type { TogetherMovePreview } from "./together-move";
import { OPENINGS, type WorldOrigin } from "./origins";
import { recruitCompanion, validRoster } from "./recruitment";
import { initializeResidentProfiles, validRoutine } from "./routines";
import { getSleepSite, inspectSleep } from "./overnight";
import { closeTravelPlan, saveTravelPlan, tickTravelPlanReminders, validTravelPlans } from "./travel-plans";
import { deleteSelectionPreset, saveSelectionPreset, validSelectionPresets } from "./selection-presets";
import { DEFAULT_FOOD_PRODUCTION_TARGET, getFoodProductionTarget, needsFoodProduction, setFoodProductionTarget, validFoodProduction } from "./food-production";
import { isCoinChoice, VILLAGE_COINS_TERMS_ID, validCurrencyState } from "./currency";
import { RIVER_PATH_RULE, getRouteWorkDuration, getRouteWorkEdgeMinutes, getRouteWorkProblem, validRouteWorkAction, validRouteWorks } from "./route-works";
import { GUARD_AGREEMENT_RULE, inspectGuardAgreement, validGuardAgreement } from "./guard-agreement";
import { SECOND_ENCOUNTER_RULE, actionEncounterId, getEncounter, getEncounters, getPresentEncounterAt, getLocalEncounter, validRidgeApproachAction, validSecondCombatAction, validSecondaryEncounter, type EncounterView } from "./encounters";
export { SECOND_ENCOUNTER_RULE, getEncounter, getEncounters, getPresentEncounterAt, getLocalEncounter } from "./encounters";
export type { EncounterView } from "./encounters";
export { GUARD_AGREEMENT_RULE, inspectGuardAgreement, isGuardPresent, isGuardPresentAt } from "./guard-agreement";
export type { GuardAgreementFact, GuardAgreementState, GuardAgreementPreview } from "./guard-agreement";
export { RIVER_PATH_RULE, getRouteWorkSummary, getRouteWorkDuration, getRouteWorkEdgeMinutes } from "./route-works";
export type { RouteWorkCompletion, RouteWorkFact, RouteWorksState, RouteWorkSummary } from "./route-works";
export { getWalletCoins, getVillageCash, COIN_WEIGHT, VILLAGE_DAILY_CASH, isCoinChoice } from "./currency";
export { inspectCoinTransfer } from "./inventory";
export type { CoinTransferPreview } from "./inventory";
export type { CoinTransfer, CurrencyState } from "./currency";
export { getVillageStock } from "./region";
export { ownFreeResources, freeBaseResources, accessibleResources, totalResources, getCarryLoad } from "./inventory";
import type {
  Action,
  ActionKind,
  AdvanceOptions,
  Command,
  EncounterId,
  GameLog,
  GameState,
  Location,
  LocationId,
  MoveCargo,
  Resident,
  Resources,
} from "./types";
import {
  createLifeState,
  ensureLife,
  finishCraft,
  finishShelf,
  finishPlacement,
  finishMeal,
  finishReturn,
  makeMorningReflections,
  selectConversationReport,
  getLifeExperienceText,
  knowsLifeEvent,
  recordExperience,
  validLifeState,
} from "./life";
import { getProjectRecipe, getProjectDuration, getLocalProjectEffects } from "./projects";
import { isOutdoorQuiet, isSceneryLocation, sceneryName } from "./scenery";
import { getCraftDisplayTitle, getCraftSubject, validCraftSubjectReference } from "./art-subject";
import { craftPresenceProblem, getCraftConversationPeer, getCraftConversationStatus, knowsCraft, validCraftConversationActions } from "./craft-conversation";
import { decideAutonomy, ensureAutonomy, pairKey, recordAutonomyStart, recordManualStay, validAutonomy, type AutonomyDecision } from "./autonomy";
import { createTradeState, inspectTrade, getMerchantOffers, tickMerchant, validTradeState, type TradeIntent, type TradePreview } from "./trade";
export { TRADE_OFFERS, getTradeOffer, getMerchantOffers, getMerchantStatus, createTradeState } from "./trade";
export type { TradeOffer, TradeOfferId, TradeReceipt, TradeState, MerchantVisit, MerchantStatus, TradePreview, TradeIntent } from "./trade";
export { getAutonomyReason } from "./autonomy";
export type { AutonomyDecision } from "./autonomy";
export { PROJECT_RECIPES, getProjectRecipe, getProjectDuration, getProjectSummary, getCraftTitle, getLocalProjectEffects } from "./projects";
export type { ProjectRecipe, ProjectSummary, ProjectRecipeId, ProjectUpgrade } from "./projects";
export { getCraftSubjectChoices, getCraftSubject, getCraftDisplayTitle, getCraftSubjectText } from "./art-subject";
export type { CraftSubjectChoice } from "./art-subject";
export { knowsCraft, getCraftConversationStatus } from "./craft-conversation";
export type { CraftConversationStatus } from "./craft-conversation";
export { getWishProgress, getResidentLife, getEventKnowledge, knowsLifeEvent } from "./life";
export type { WishProgress, LifeSuggestion } from "./life";
export type {
  Action,
  ActionKind,
  AdvanceOptions,
  Command,
  EncounterId,
  GameLog,
  GameState,
  LocationId,
  Resident,
  Resources,
  ConversationReport,
  EventKnowledge,
} from "./types";

export const LOCATIONS: Record<LocationId, Location> = {
  home: {
    id: "home",
    name: "共同の居間",
    description:
      "使い込まれた食卓。窓の向こうで、草が風に揺れている。みんなの一日はここから始まる。",
    kind: "base",
    connections: ["kitchen", "bedroom", "garden", "road"],
  },
  kitchen: {
    id: "kitchen",
    name: "小さな台所",
    description:
      "鍋は一つ、薪は十分。湯気と焼いた野菜の匂いが、この家を家らしくする。",
    kind: "base",
    connections: ["home"],
  },
  bedroom: {
    id: "bedroom",
    name: "寝床と私室",
    description:
      "寝床と、まだ何も置かれていない窓辺。自分の居場所を少しずつ作れる。",
    kind: "base",
    connections: ["home"],
  },
  garden: {
    id: "garden",
    name: "裏庭",
    description:
      "石垣のそばに食べられる草が育っている。遠くへ出なくても、小さな収穫は見つかる。",
    kind: "base",
    connections: ["home"],
  },
  road: {
    id: "road",
    name: "草の道",
    description:
      "古い轍の続く道。東の回収場所には人影がある。木陰を通れば争いを避けられそうだ。",
    kind: "wild",
    connections: ["home", "ruins", "shelter", "meadow"],
  },
  ruins: {
    id: "ruins",
    name: "旧い資材置き場",
    description:
      "崩れた壁の奥に物資が残る。ここを縄張りにしている流れ者が、入口を見張っている。",
    kind: "wild",
    connections: ["road", "shelter", "ridge"],
  },
  shelter: {
    id: "shelter",
    name: "木陰の迂回路",
    description:
      "低い石垣に沿った安全な脇道。雨をしのげる低い屋根もある。置き場の外に少しだけ物資が残っている。争わず持ち帰れる。",
    kind: "wild",
    connections: ["road", "ruins"],
  },
  ...REGION_LOCATIONS,
};
export const ACTION_LABELS: Record<ActionKind, string> = {
  cook: "料理をする",
  eat: "食事をとる",
  rest: "ひと息つく",
  socialize: "話をする",
  hobby: "木彫りをする",
  decorate: "窓辺を整える",
  "place-craft": "作品を飾る",
  project: "手仕事の計画",
  "repair-route": "川沿いの道を整える",
  "approach-ridge": "尾根の人影へ近づく",
  gather: "物資を集める",
  observe: "景色を眺める",
  move: "移動する",
  attack: "攻撃を続ける",
  defend: "防御・援護する",
  rescue: "仲間を救助する",
  heal: "手当をする",
  sleep: "眠る（最長8時間）",
  help: "仕事を手伝う",
};
const RESOURCE_KEYS = ["food", "ingredients", "medicine", "scrap"] as const;
const RESOURCE_NAMES: Record<keyof Resources, string> = { food: "食事", ingredients: "食材", medicine: "手当用品", scrap: "資材" };
function validMoveCargo(value: unknown): value is MoveCargo {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const cargo = value as Record<string, unknown>;
  return Object.keys(cargo).length === 2 && Object.keys(cargo).every(key => key === "resource" || key === "amount")
    && RESOURCE_KEYS.includes(cargo.resource as keyof Resources)
    && typeof cargo.amount === "number" && Number.isSafeInteger(cargo.amount) && cargo.amount > 0;
}
function exactCargoReservation(action: Action): boolean {
  const cargo = action.cargo;
  return validMoveCargo(cargo) && !!action.reserved && typeof action.reserved === "object" && !Array.isArray(action.reserved)
    && Object.keys(action.reserved).length === 1 && action.reserved[cargo.resource] === cargo.amount
    && action.reservationSource === "pack" && action.materialTransfers === undefined;
}
const cargoLabel = (cargo: MoveCargo) => `${RESOURCE_NAMES[cargo.resource]}${cargo.amount}`;
const ACTION_KINDS = Object.keys(ACTION_LABELS) as ActionKind[];
const HELPABLE_ACTIONS: ActionKind[] = ["cook", "gather", "hobby", "decorate", "project"];
const CONVERSATION_BLOCKERS: ActionKind[] = ["sleep", "move", "rescue", "attack"];
const clone = <T>(value: T): T => structuredClone(value);
const clamp = (n: number, max = 100) => Math.max(0, Math.min(max, n));
const isLocation = (value: unknown): value is LocationId =>
  typeof value === "string" && Object.hasOwn(LOCATIONS, value);
function lodgeWork(kind: ActionKind, target?: string): boolean {
  return kind === "cook" || kind === "rest" || kind === "hobby"
    || (kind === "project" && (target === "wood-flower" || target === "crafting-tools"));
}
const atBase = (r: Resident) => LOCATIONS[r.location].kind === "base";
const validRescueTarget = (carrier: Resident, patient: Resident | undefined) => !!patient
  && patient.id !== carrier.id && patient.location === carrier.location && !atBase(patient) && patient.hp <= 35;
const finiteCache = (location: LocationId) => location === "shelter" || location === "ruins";
const recoveredCache = (s: GameState, location: LocationId) => location === "shelter"
  ? !!s.flags.safeSuppliesRecovered : location === "ruins" && s.flags.suppliesRecovered;
const guardedCache = (s: GameState, location: LocationId) => finiteCache(location)
  && getPresentEncounterAt(s, location);
function holdRouteWork(s: GameState, r: Resident, a: Action, reason: string) {
  // A failed final check cannot leave a finished-but-unconsumed saved job.
  a.progress = Math.min(a.progress, a.duration - 1);
  if (r.suspended) return; // Both explicit slots remain intact; only this work is blocked.
  r.suspended = a;
  r.action = null;
  log(s, "system", "道の整備を中断した", `${r.name}は道の整備を中断した。${reason} 進捗と確保した資材は保持している。`, [r]);
}
export type RidgeApproachPreview = {
  rule: typeof SECOND_ENCOUNTER_RULE; actorId?: string; actorName?: string;
  completed?: GameState["secondaryEncounter"]; error?: string;
};
function ridgeApproachProblem(s: GameState, r: Resident, action?: Action): string | undefined {
  if (s.ended) return "この試行は終了しています。保存から再開してください。";
  if (s.secondaryEncounter) return "尾根の人影にはすでに近づいています。相手と周囲の様子を確認してください。";
  if (r.hp <= 0 || r.action?.kind === "sleep") return "起きて動けるようになってから、人影へ近づけます。";
  if (r.location !== SECOND_ENCOUNTER_RULE.location || (action && action.origin !== r.location))
    return "尾根へ戻ってから、人影へ近づけます。";
  if (!canShareAtCurrentLocation(s, r.id)) return "移動や救助・運搬を終えてから、人影へ近づけます。";
  if (getPresentEncounterAt(s, r.location)) return "ここには交戦中の相手がいます。先に相手と退路を確認してください。";
  if (s.residents.some(other => [other.action, other.suspended].some(job => job?.kind === "approach-ridge" && job.id !== action?.id)))
    return "人影へ近づく指示が残っています。いまの仕事で進捗や取消を確認してください。";
  if (!Number.isSafeInteger(s.nextId) || s.nextId >= Number.MAX_SAFE_INTEGER - (action ? 0 : 1))
    return "遭遇を記録する番号を確保できません。指示と進捗は保持しています。";
  return undefined;
}
export function inspectRidgeApproach(s: GameState, residentIds: readonly string[]): RidgeApproachPreview {
  const result: RidgeApproachPreview = { rule: SECOND_ENCOUNTER_RULE,
    ...(s.secondaryEncounter ? { completed: { ...s.secondaryEncounter } } : {}) };
  if (!Array.isArray(residentIds) || residentIds.length !== 1 || typeof residentIds[0] !== "string")
    return { ...result, error: "人影へ近づく住民を、住民一覧で一人だけ選んでください。" };
  const actor = s.residents.find(r => r.id === residentIds[0]);
  if (!actor) return { ...result, error: "選択した住民が見つかりません。" };
  const problem = ridgeApproachProblem(s, actor)
    ?? (actor.energy <= 2 ? `${actor.name}は疲れ切っています。先に休息してください。` : undefined)
    ?? (actor.action && !actor.action.automatic && actor.suspended ? `${actor.name}には中断中の仕事があります。再開または取り消しを選んでください。` : undefined);
  return { ...result, actorId: actor.id, actorName: actor.name, ...(problem ? { error: problem } : {}) };
}
/** The current job's own identity is excluded when displaying a paused-in-place work. */
export function getRidgeApproachProblem(s: GameState, residentId: string): string | undefined {
  const resident = s.residents.find(r => r.id === residentId);
  return resident?.action?.kind === "approach-ridge"
    ? ridgeApproachProblem(s, resident, resident.action) : undefined;
}
function holdRidgeApproach(s: GameState, r: Resident, a: Action, reason: string) {
  a.progress = Math.min(a.progress, a.duration - 1);
  if (!r.suspended) { r.suspended = a; r.action = null; }
  s.pauseReason ||= `${r.name}は人影への接近を止めています。${reason}`;
}
function observationProblem(s: GameState, r: Resident, action?: Action): string | undefined {
  if (!isSceneryLocation(r.location))
    return "景色を眺めるには、草の道・木陰の迂回路・資材置き場へ移動してください。";
  if (action && action.origin !== r.location)
    return "景色を眺め始めた場所へ戻ってから再開してください。";
  if (getPresentEncounterAt(s, r.location))
    return "ここには流れ者がいます。景色を眺める前に、戦闘か退路を確かめてください。";
  return undefined;
}
function stopObservation(s: GameState, r: Resident, reason: string) {
  r.action = null;
  log(s, "system", "景色を眺めるのはまた今度", `${r.name}は景色を眺めるのを見合わせた。${reason}`, [r]);
  s.pauseReason ||= `${r.name}が景色を眺めるのを見合わせました。${reason}`;
}
export function formatTime(minutes: number): string {
  const t = Math.floor(minutes) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}
function random(s: GameState) {
  s.seed = (Math.imul(s.seed, 1664525) + 1013904223) >>> 0;
  return s.seed / 4294967296;
}
function log(
  s: GameState,
  type: GameLog["type"],
  title: string,
  text: string,
  actors: Resident[] = [],
  memorable = false,
  memoryText?: (resident: Resident) => string,
  encounter?: EncounterView,
) {
  const locations = new Set(actors.map((r) => r.location));
  const witnesses = s.residents
    .filter(
      (r) =>
        locations.has(r.location) && r.hp > 0 && r.action?.kind !== "sleep",
    )
    .map((r) => r.id);
  const entry: GameLog = {
    id: s.nextId++,
    time: s.minutes,
    type,
    title,
    text,
    actors: [...new Set(actors.map((r) => r.id))],
    witnesses,
  };
  if (encounter?.id === "ridge-watch") entry.encounter = { id: encounter.id, location: encounter.location };
  s.logs.push(entry);
  // Facts stay in the journal; only participants and conscious witnesses receive memories.
  if (memorable)
    for (const r of s.residents)
      if (
        witnesses.includes(r.id) ||
        actors.some((a) => a.id === r.id && r.hp > 0 && r.action?.kind !== "sleep")
      )
        r.memories.push(
          `第${Math.floor(s.minutes / 1440) + 1}日 ${formatTime(s.minutes)}｜${memoryText?.(r) ?? text}`,
        );
}
/** A cancelled delivery unlocks the same physical goods; it never spends them. */
function stopCargo(s: GameState, r: Resident, action: Action, reason: string) {
  if (!action.cargo) return;
  const item = validMoveCargo(action.cargo) ? cargoLabel(action.cargo) : "指定した荷物";
  log(s, "system", "運搬を中止した", `${r.name}の${item}の運搬を中止した。${reason}品は本人の荷物に残り、運搬用の確保を解除した。`, [r]);
  s.pauseReason ||= `${r.name}の運搬を中止しました。品は本人の荷物に残っています。`;
}
function depositCargo(s: GameState, r: Resident, action: Action): string | undefined {
  if (!atBase(r)) return "倉庫へ納めるには、本人が拠点へ戻る必要があります。";
  if (!exactCargoReservation(action)) return "運搬する品と確保した数量を確認できません。";
  const cargo = action.cargo!, pack = s.inventory?.packs[r.id];
  const attached = [r.action, r.suspended].some(job => job?.id === action.id);
  // Completion normally detached its job; a local explicit handoff is still held.
  // In either case leave every other current/held reservation fully backed.
  if (!pack || pack[cargo.resource] < cargo.amount
    || ownFreeResources(s, r.id)[cargo.resource] < (attached ? 0 : cargo.amount))
    return "確保した荷物を確認できません。本人の所持品を確認してください。";
  pack[cargo.resource] -= cargo.amount;
  s.resources[cargo.resource] += cargo.amount;
  log(s, "work", "荷物を倉庫へ届けた", `${r.name}が本人の荷物から拠点倉庫へ${cargoLabel(cargo)}を納めた。`, [r]);
}
export function createGame(seed = 20261119, origin: WorldOrigin = "household"): GameState {
  const opening = OPENINGS[origin];
  const ids = origin === "household" ? ["aki", "mio", "ren"] : ["aki"];
  const specs = [
    {
      id: "aki",
      name: "アキ",
      role: "あなた",
      traits: ["好奇心旺盛", "手仕事が好き"],
      wish: "自分の窓辺に、手作りのものを置きたい",
      skills: { cooking: 2, combat: 2, craft: 4 },
      weapon: "knife" as const,
      armor: false,
    },
    {
      id: "mio",
      name: "ミオ",
      role: "料理と暮らし",
      traits: ["世話好き", "おしゃべり"],
      wish: "みんなで温かい食事を囲みたい",
      skills: { cooking: 6, combat: 2, craft: 2 },
      weapon: "staff" as const,
      armor: false,
    },
    {
      id: "ren",
      name: "レン",
      role: "探索と護衛",
      traits: ["慎重", "静かな場所が好き"],
      wish: "無理をせず、明日の物資を見つけたい",
      skills: { cooking: 1, combat: 6, craft: 3 },
      weapon: "spear" as const,
      armor: true,
    },
  ];
  const residents: Resident[] = specs.filter((r) => ids.includes(r.id)).map((r) => ({
    ...r,
    location: opening.location,
    hp: 100,
    hunger: 73,
    energy: 88,
    mood: 72,
    policy: "balanced",
    action: null,
    suspended: null,
    relations: Object.fromEntries(
      ids
        .filter((id) => id !== r.id)
        .map((id) => [
          id,
          {
            closeness: r.id === "mio" ? 34 : 25,
            trust: r.id === "ren" ? 38 : 30,
          },
        ]),
    ),
    memories: [],
    wounds: { arm: 0, leg: 0, body: 0 },
  }));
  const s: GameState = {
    version: 3,
    ...(origin !== "household" ? { origin } : {}),
    minutes: 480,
    seed: seed >>> 0,
    residents,
    resources: { food: 6, ingredients: 8, medicine: 3, scrap: 4 },
    logs: [],
    enemy: { hp: 80, location: "ruins", defeated: false },
    flags: {
      decorated: false,
      hobbyFinished: false,
      suppliesRecovered: false,
      safeSuppliesRecovered: false,
    },
    nextId: 1,
    ended: false,
    autoCombat: false,
    life: createLifeState(),
    trade: createTradeState(480),
    region: createRegionState({ minutes: 480 }),
  };
  const inventory = ensureInventory(s);
  initializeResidentProfiles(s);
  if (origin !== "household") {
    inventory.packs.aki = { ...opening.pack };
    for (const key of RESOURCE_KEYS) s.resources[key] -= opening.pack[key];
    log(s, "life", opening.name, opening.opening, residents, true);
    return s;
  }
  log(
    s,
    "life",
    "三人の朝",
    opening.opening,
    residents,
    true,
  );
  log(
    s,
    "social",
    "ミオのひとこと",
    "「お昼は一緒に食べよう。外に出るなら、何か温かいものを用意しておくね」",
    [residents[1]],
    true,
  );
  return s;
}
export function availableResources(s: GameState): Resources {
  return freeBaseResources(s);
}
function baseEdgeMinutes(state: GameState | undefined, from: LocationId, to: LocationId): number {
  return (state ? getRouteWorkEdgeMinutes(state, from, to) : undefined) ?? regionEdgeMinutes(from, to)
    ?? (LOCATIONS[from].kind === "base" && LOCATIONS[to].kind === "base" ? 3 : from === "home" || to === "home" ? 15 : 8);
}
function pathBetween(state: GameState, from: LocationId, to: LocationId, avoid?: ReadonlySet<LocationId>): LocationId[] {
  const queue: { path: LocationId[]; cost: number }[] = [{ path: [from], cost: 0 }];
  const visited = new Set<LocationId>();
  while (queue.length) {
    queue.sort((a, b) => a.cost - b.cost);
    const current = queue.shift()!;
    const last = current.path[current.path.length - 1];
    if (last === to) return current.path.slice(1);
    if (visited.has(last)) continue;
    visited.add(last);
    for (const next of LOCATIONS[last].connections) {
      if (!avoid?.has(next) && !visited.has(next)) queue.push({ path: [...current.path, next], cost: current.cost + baseEdgeMinutes(state, last, next) });
    }
  }
  return [];
}
function defaultTravelPath(state: GameState, from: LocationId, to: LocationId): LocationId[] {
  const danger = new Set(getEncounters(state).filter(e => e.present && e.location !== to).map(e => e.location));
  if ((LOCATIONS[to].kind === "base" || to === "lodge" || to === "reedbank") && danger.size) {
    const safe = pathBetween(state, from, to, danger);
    if (safe.length) return safe;
  }
  return pathBetween(state, from, to);
}
function edgeDuration(from: LocationId, to: LocationId, r: Resident, state?: GameState): number {
  const base = baseEdgeMinutes(state, from, to);
  return Math.ceil(base * (1 + r.wounds.leg * 0.35) * (state ? getCarryLoad(state, r.id).multiplier : 1));
}
/** Only a newly completed roadwork triggers this narrow end-of-minute update. */
function refreshTravelAfterRouteWork(s: GameState) {
  refreshTogetherTravel(s, (from, to, r) => edgeDuration(from, to, r, s));
  for (const r of s.residents) {
    const a = r.action;
    if (!a || a.together || !["move", "rescue"].includes(a.kind) || !a.path) continue;
    const index = a.segment ?? 0;
    if (index >= a.path.length) continue;
    if ((a.segmentProgress ?? 0) === 0 && getRouteWorkEdgeMinutes(s, r.location, a.path[index]) !== undefined)
      a.segmentDuration = edgeDuration(r.location, a.path[index], r, s);
    let from = a.path[index];
    a.duration = a.progress + Math.max(0, (a.segmentDuration ?? 1) - (a.segmentProgress ?? 0))
      + a.path.slice(index + 1).reduce((sum, next) => { const cost = edgeDuration(from, next, r, s); from = next; return sum + cost; }, 0);
  }
}
/** Preview the same path and individual pace used by a direct move. */
export function inspectTravelRoute(state: GameState, residentId: string, destination: LocationId, avoidEncounters = false) {
  const resident = state.residents.find(person => person.id === residentId);
  if (!resident || !isLocation(destination)) return;
  if (resident.location === destination) return { path: [] as LocationId[], minutes: 0 };
  const path = avoidEncounters
    ? pathBetween(state, resident.location, destination, new Set(getEncounters(state).filter(e => e.present).map(e => e.location)))
    : defaultTravelPath(state, resident.location, destination);
  if (!path.length) return;
  let previous = resident.location;
  let minutes = 0;
  for (const place of path) {
    minutes += edgeDuration(previous, place, resident, state);
    previous = place;
  }
  return { path, minutes };
}
export function estimateTravelMinutes(state: GameState, residentId: string, destination: LocationId): number | undefined {
  return inspectTravelRoute(state, residentId, destination)?.minutes;
}
/** A pure trial of a new, one-trip pair. No old movement is linked implicitly. */
export function inspectTogetherMove(state: GameState, residentIds: string[], target: LocationId, via?: LocationId[]): TogetherMovePreview {
  const residents: TogetherMovePreview["residents"] = [];
  const fail = (error: string): TogetherMovePreview => ({ error, residents });
  if (state.ended) return fail("この試行は終了しています。");
  if (!Array.isArray(residentIds) || residentIds.length !== 2 || new Set(residentIds).size !== 2
    || residentIds.some(id => typeof id !== "string")) return fail("一緒に移動する住民を、二人だけ選んでください。");
  if (!isLocation(target) || (via !== undefined && (!Array.isArray(via) || via.length > 10 || via.some(id => !isLocation(id)))))
    return fail("移動先と道順を確認してください。");
  const people = residentIds.map(id => state.residents.find(r => r.id === id));
  if (people.some(r => !r)) return fail("選択した住民が見つかりません。");
  const pair = people as Resident[];
  if (pair.some(r => r.hp <= 0 || r.action?.kind === "sleep")) return fail("二人が起きてから、一緒に移動できます。");
  if (pair.some(r => ["move", "rescue"].includes(r.action?.kind ?? "") || !canShareAtCurrentLocation(state, r.id)))
    return fail("移動・救助・運搬を終えるか取り消し、同じ場所で合流してから一緒に移動してください。");
  if (pair[0].location !== pair[1].location) return fail("一緒に移動する二人は、同じ場所にいる必要があります。");
  for (const r of pair) if (r.action && !r.action.automatic && r.suspended)
    return fail(`${r.name}には中断中の仕事があります。再開または取り消しを選んでください。`);
  const origin = pair[0].location;
  if (origin === target) return fail("すでにその場所にいます。");
  let path: LocationId[];
  if (via?.length) {
    const index = via.lastIndexOf(origin), waypoints = [...(index >= 0 ? via.slice(index + 1) : via), target];
    path = [];
    let from = origin;
    for (const point of waypoints) {
      if (point === from) continue;
      const part = pathBetween(state, from, point);
      if (!part.length) return fail("その道順では移動できません。");
      path.push(...part); from = point;
    }
  } else path = defaultTravelPath(state, origin, target);
  if (!path.length) return fail("移動できる道がありません。");
  let from = origin, minutes = 0;
  const individual = [0, 0];
  for (const to of path) {
    const costs = pair.map((r, index) => { const cost = edgeDuration(from, to, r, state); individual[index] += cost; return cost; });
    minutes += Math.max(...costs); from = to;
  }
  pair.forEach((r, i) => residents.push({ id: r.id, name: r.name, individualMinutes: individual[i] }));
  if (!Number.isSafeInteger(state.nextId) || !Number.isSafeInteger(state.nextId + 2)) return fail("行動の記録番号が不足しています。別の保存を確認してください。");
  return { residents, minutes, path, origin };
}
export function getAutonomyDecision(state: GameState, residentId: string): AutonomyDecision | undefined {
  return decideAutonomy(state, residentId, (place) => estimateTravelMinutes(state, residentId, place), accessibleResources(state, residentId));
}
/** An actual autonomous approach, not a claim that the listener has responded. */
export function getIncomingConversation(state: GameState, residentId: string): { speakerIds: string[]; listenerId: string } | undefined {
  const listener = state.residents.find((r) => r.id === residentId);
  if (state.ended || !listener || listener.hp <= 0 || listener.action || listener.suspended || !atBase(listener)) return;
  const speakerIds = state.residents.filter((r) => r.id !== residentId && r.hp > 0 && r.location === listener.location
    && r.action?.kind === "socialize" && r.action.automatic === true && r.action.target === residentId).map((r) => r.id);
  return speakerIds.length ? { speakerIds, listenerId: residentId } : undefined;
}
function makeAction(
  s: GameState,
  r: Resident,
  kind: ActionKind,
  target?: string,
  automatic = false,
  subjectEventId?: number,
  encounterId?: EncounterId,
): Action | string {
  if (encounterId !== undefined && (!["attack", "defend"].includes(kind)
    || !["ruins-guard", "ridge-watch"].includes(encounterId))) return "攻撃・防御の相手を確認してください。";
  const free = accessibleResources(s, r.id);
  const base = atBase(r);
  const peer = target ? s.residents.find((x) => x.id === target) : undefined;
  if (r.hp <= 0)
    return base
      ? `${r.name}は意識を失っています。時間を進めて意識の回復を確かめるか、仲間の手当を確認してください。`
      : `${r.name}は意識を失っています。仲間による救助と手当が必要です。`;
  if (r.energy <= 2 && !["rest", "sleep", "eat", "move"].includes(kind))
    return `${r.name}は疲れ切っています。先に休息してください。`;
  const a: Action = {
    id: s.nextId++,
    kind,
    label: ACTION_LABELS[kind],
    progress: 0,
    duration: 30,
    ...(target ? { target } : {}),
    automatic,
    origin: r.location,
    ...(encounterId === "ridge-watch" ? { encounterId } : {}),
  };
  if (subjectEventId !== undefined) {
    if (automatic || !((kind === "hobby" && target === undefined)
      || (kind === "project" && target === "wood-flower")))
      return "景色を題材にできるのは、直接指示する小鳥か花の木彫りです。";
    if (!validCraftSubjectReference(s, r.id, subjectEventId, a.id, s.minutes))
      return "題材には、この住民が実際に景色を眺めた記録を選んでください。";
    a.subjectEventId = subjectEventId;
  }
  const baseOnly = [
    "cook",
    "rest",
    "socialize",
    "hobby",
    "decorate",
    "place-craft",
    "project",
    "help",
  ];
  if (baseOnly.includes(kind) && !base && !(r.location === "lodge" && lodgeWork(kind, target))) {
    const place = lodgeWork(kind, target) ? "丘のふもとの拠点か舟宿の工房" : "丘のふもとの拠点";
    return `${r.name}は今、${LOCATIONS[r.location].name}にいます。この指示は${place}で行えます。`;
  }
  if (!base && ["eat", "heal"].includes(kind) && getPresentEncounterAt(s, r.location))
    return "ここではまだ交戦の危険があります。退路を確保してから食事や手当をしてください。";
  switch (kind) {
    case "cook":
      if (free.ingredients < 2)
        return r.location === "lodge" ? "舟宿の鍋には手持ちの食材が2個必要です。葦原で集めるか、物置から取り出してください。"
          : "料理には未予約の食材が2個必要です。裏庭で集めるか、中断した料理を再開してください。";
      if (
        s.residents.some((x) =>
          [x.action, x.suspended].some((t) => t?.kind === "cook" && workSite(t.origin) === workSite(r.location)),
        )
      )
        return "鍋は他の住民が使用中です。その料理が終わるか取り消すまで待ってください。";
      a.duration = Math.max(20, 40 - r.skills.cooking * 3)
        * getLocalProjectEffects(s, r.location).cookingMultiplier;
      a.reserved = { ingredients: 2 };
      break;
    case "eat":
      if (free.food < 1)
        return "用意された食事がありません。食材を料理してください。";
      a.duration = 15;
      a.reserved = { food: 1 };
      break;
    case "rest":
      a.duration = 30;
      break;
    case "observe": {
      if (target !== undefined)
        return "景色を眺めるのは、住民が今いる場所です。移動先は指定しません。";
      const problem = observationProblem(s, r);
      if (problem) return problem;
      a.duration = 20;
      break;
    }
    case "sleep": {
      const problem = inspectSleep(s, r.id).error;
      if (problem) return problem;
      let wakeTime = Math.floor(s.minutes / 1440) * 1440 + 480;
      if (wakeTime <= s.minutes) wakeTime += 1440;
      a.duration = Math.min(480, wakeTime - s.minutes);
      break;
    }
    case "socialize":
      if (
        !peer ||
        peer.id === r.id ||
        peer.location !== r.location ||
        peer.hp <= 0
      )
        return "同じ場所にいる、意識のある仲間を選んでください。";
      if (
        peer.action &&
        (CONVERSATION_BLOCKERS.includes(peer.action.kind) || (automatic && peer.action.topic !== undefined))
      )
        return `${peer.name}は今、話に応じられません。`;
      a.duration = 20;
      a.label = `${peer.name}と話す`;
      break;
    case "hobby":
      a.duration = 45 * getLocalProjectEffects(s, r.location).craftingMultiplier;
      break;
    case "project": {
      const recipe = getProjectRecipe(target);
      if (!recipe) return "制作するものを選んでください。";
      if (!recipe.repeatable && s.life?.upgrades?.some((upgrade) => upgrade.recipeId === recipe.id && workSite(upgrade.location) === workSite(r.location)))
        return "この設備はもう完成しています。拠点で設置場所と効果を確認できます。";
      if (!recipe.repeatable && s.residents.some((other) => [other.action, other.suspended]
        .some((job) => job?.kind === "project" && job.target === recipe.id && workSite(job.origin) === workSite(r.location))))
        return "同じ設備を制作中、または中断中の住民がいます。完了か取消を待ってください。";
      if (RESOURCE_KEYS.some((key) => free[key] < (recipe.cost[key] ?? 0)))
        return `${recipe.title}には、未予約の資材${recipe.cost.scrap ?? 0}個が必要です。`;
      a.duration = getProjectDuration(s, r.id, recipe.id)!;
      a.reserved = { ...recipe.cost };
      a.label = recipe.title;
      break;
    }
    case "repair-route": {
      if (target !== RIVER_PATH_RULE.id || automatic) return "整備する川沿いの道を選んでください。";
      const problem = getRouteWorkProblem(s, r);
      if (problem) return problem;
      if (ownFreeResources(s, r.id).scrap < RIVER_PATH_RULE.cost.scrap)
        return "川沿いの道の整備には、本人の手持ちの未予約資材が2個必要です。";
      a.duration = getRouteWorkDuration(s, r.id)!;
      a.reserved = { ...RIVER_PATH_RULE.cost };
      break;
    }
    case "decorate":
      if (s.life?.shelf)
        return "窓辺はもう整っています。木彫りや休息で、この場所を楽しめます。";
      if (
        s.residents.some((x) =>
          [x.action, x.suspended].some((t) => t?.kind === "decorate"),
        )
      )
        return "別の住民が窓辺を整えています。完了か取消を待ってください。";
      if (s.flags.decorated) {
        a.duration = 10;
        a.restoringShelf = true;
        a.label = "棚をここへ整える";
      } else {
        if (free.scrap < 2) return "窓辺を整えるには回収材が2個必要です。";
        a.duration = 25;
        a.reserved = { scrap: 2 };
      }
      break;
    case "place-craft": {
      if (!s.life?.shelf)
        return "先に窓辺を整えて、作品を飾る棚を用意してください。";
      if (s.life.shelf.location !== r.location)
        return "作品を持って、棚のある場所へ移動してください。";
      const craft = s.life.crafts.find(
        (c) =>
          c.authorId === r.id &&
          c.displayedAt === undefined &&
          (target === undefined || String(c.id) === target),
      );
      if (!craft) return "自分で仕上げた、まだ飾っていない木彫りが必要です。";
      if (
        s.residents.some((x) =>
          [x.action, x.suspended].some(
            (t) => t?.kind === "place-craft" && t.target === String(craft.id),
          ),
        )
      )
        return "その作品はすでに飾る準備中です。中断した行動を再開するか取り消してください。";
      a.target = String(craft.id);
      a.duration = 5;
      break;
    }
    case "gather":
      if (!["garden", "ruins", "shelter"].includes(r.location) && !isHarvestLocation(r.location))
        return "裏庭、資材置き場、木陰の迂回路、川沿いの採集地、上流の葦原で物資を集められます。先に移動してください。";
      if (r.location === "ruins" && s.flags.suppliesRecovered)
        return "この資材置き場の物資は回収済みです。裏庭では食材を集められます。";
      if (r.location === "shelter" && s.flags.safeSuppliesRecovered)
        return "迂回路の物資は回収済みです。";
      if (guardedCache(s, r.location))
        return "この場所には物資を守る流れ者がいます。先に戦闘か撤退を確認してください。";
      if (isHarvestLocation(r.location) && !regionHarvestAvailable(s, r.location))
        return `今日の${HARVEST_SITES[r.location].name}の収穫は済んでいます。明日また様子を見られます。`;
      a.duration = isHarvestLocation(r.location) ? HARVEST_SITES[r.location].minutes : r.location === "garden" ? 25 : 20;
      break;
    case "move": {
      if (!isLocation(target)) return "移動先を選んでください。";
      if (target === r.location) return "すでにその場所にいます。";
      const path = defaultTravelPath(s, r.location, target as LocationId);
      if (!path.length) return "移動できる道がありません。";
      let previous = r.location;
      a.duration = path.reduce((sum, p) => {
        const d = edgeDuration(previous, p, r, s);
        previous = p;
        return sum + d;
      }, 0);
      a.path = path;
      a.segment = 0;
      a.segmentProgress = 0;
      a.segmentDuration = edgeDuration(r.location, path[0], r, s);
      a.origin = r.location;
      a.label = `${LOCATIONS[target as LocationId].name}へ移動`;
      break;
    }
    case "attack":
    case "defend": {
      const encounter = getEncounter(s, encounterId ?? "ruins-guard");
      if (!encounter?.present || encounter.location !== r.location)
        return kind === "attack" ? "ここに交戦中の相手はいません。" : encounterId === "ridge-watch" ? "防御・援護は相手と交戦中に使えます。" : "防御・援護は資材置き場で交戦中に使えます。";
      a.duration = kind === "attack" ? 2 : 60;
      break;
    }
    case "approach-ridge": {
      if (automatic || target !== undefined) return "人影への接近には、尾根にいる一人を選んでください。";
      const problem = ridgeApproachProblem(s, r, a);
      if (problem) return problem;
      a.duration = SECOND_ENCOUNTER_RULE.approachMinutes;
      break;
    }
    case "rescue":
      if (
        !peer ||
        peer.id === r.id ||
        peer.location !== r.location ||
        peer.hp > 35
      )
        return "同じ場所の重傷・気絶した仲間を救助できます。まずその場所へ移動してください。";
      if (
        s.residents.some(
          (x) =>
            x.id !== r.id &&
            x.hp > 0 && validRescueTarget(x, peer) &&
            [x.action, x.suspended].some(
              (t) => t?.kind === "rescue" && t.target === peer.id,
            ),
        )
      )
        return "その仲間はすでに別の住民が救助中です。";
      if (r.wounds.arm >= 3 || r.hp < 30)
        return "運搬する力が足りません。別の住民に救助を任せてください。";
      if (atBase(peer)) return "すでに拠点内です。手当をしてください。";
      a.path = pathBetween(s, r.location, "home", new Set(getEncounters(s).filter(e => e.present && e.location !== r.location).map(e => e.location)));
      if (!a.path.length) return "拠点へ戻れる経路を確認できません。";
      a.segment = 0;
      a.segmentProgress = 0;
      const carrying = { ...s, residents: s.residents.map((p) => p.id === r.id ? { ...p, action: a } : p) };
      let rescueFrom = r.location;
      a.duration = a.path.reduce((sum, next) => { const cost = edgeDuration(rescueFrom, next, r, carrying); rescueFrom = next; return sum + cost; }, 0);
      a.segmentDuration = edgeDuration(r.location, a.path[0], r, carrying);
      a.label = `${peer.name}を運んで帰る`;
      a.origin = r.location;
      break;
    case "heal":
      if (!peer) a.target = r.id;
      else if (peer.location !== r.location)
        return `${peer.name}と同じ${atBase(r) && atBase(peer) ? "部屋" : "場所"}へ移動してから手当してください。`;
      if (peer && peer.location !== r.location)
        return `${peer.name}と同じ部屋へ移動してから手当してください。`;
      if (
        (peer || r).hp >= 100 &&
        !Object.values((peer || r).wounds).some((v) => v > 0)
      )
        return "その人物に手当の必要はありません。";
      if (free.medicine < 1)
        return "手当用品がありません。休息でもゆっくり回復できます。";
      if (
        s.residents.some(
          (x) => x.action?.kind === "heal" && x.action.target === a.target,
        )
      )
        return "その人物はすでに手当中です。";
      a.duration = 20;
      a.reserved = { medicine: 1 };
      a.label = `${(peer || r).name}を手当する`;
      break;
    case "help":
      if (
        !peer ||
        peer.id === r.id ||
        peer.location !== r.location ||
        !peer.action ||
        !HELPABLE_ACTIONS.includes(peer.action.kind)
      )
        return "同じ場所で料理・採集・手仕事をしている仲間を選んでください。";
      a.duration = 10;
      a.label = `${peer.name}の仕事を手伝う`;
      a.targetActionId = peer.action.id;
      break;
  }
  if (
    [
      "cook",
      "gather",
      "hobby",
      "decorate",
      "place-craft",
      "help",
      "heal",
    ].includes(kind)
  )
    a.duration = Math.ceil(a.duration * (1 + r.wounds.arm * 0.25));
  if (kind === "hobby" || kind === "project") {
    const tools = s.life?.upgrades?.find(upgrade => upgrade.recipeId === "crafting-tools" && upgrade.location === r.location);
    if (tools) a.craftingToolsId = tools.id;
  }
  const subject = getCraftSubject(s, a);
  if (subject)
    a.label = `${sceneryName(subject.location)}を題材に${kind === "hobby" ? "小鳥" : "花"}を彫る`;
  const reservationError = reserveActionResources(s, r, a);
  if (reservationError) return reservationError;
  return a;
}
export function command(state: GameState, cmd: Command): { state: GameState; error?: string } {
  const result = applyCommand(state, cmd);
  if (!result.error && result.state !== state)
    normalizeTogetherMoves(result.state, (from, to, r) => edgeDuration(from, to, r, result.state));
  return result;
}
function applyCommand(
  state: GameState,
  cmd: Command,
): { state: GameState; error?: string } {
  const s = clone(state);
  if (cmd.type === "move-together") {
    if (Object.keys(cmd).some(key => !["type", "residentIds", "target", "via"].includes(key)))
      return { state, error: "同行移動の指示を確認してください。" };
    const preview = inspectTogetherMove(state, cmd.residentIds, cmd.target, cmd.via);
    if (preview.error) return { state, error: preview.error };
    const people = cmd.residentIds.map(id => s.residents.find(r => r.id === id)!);
    for (const r of people) {
      if (r.action && !r.action.automatic) r.suspended = r.action;
      r.action = null;
    }
    const jobs = people.map(r => makeAction(s, r, "move", cmd.target));
    const problem = jobs.find(job => typeof job === "string");
    if (typeof problem === "string") return { state, error: problem };
    const actions = jobs as Action[];
    const firstDuration = Math.max(...people.map(r => edgeDuration(preview.origin!, preview.path![0], r, s)));
    for (let i = 0; i < 2; i++) {
      const a = actions[i];
      a.path = [...preview.path!]; a.duration = preview.minutes!; a.segmentDuration = firstDuration;
      a.together = { peerResidentId: people[1 - i].id, peerActionId: actions[1 - i].id };
      people[i].action = a;
    }
    s.version = 5;
    return { state: s };
  }
  if (cmd.type === "exhibit-village-art" || cmd.type === "hear-village-art") {
    const result = applyVillageArt(s, cmd);
    if ("error" in result) return { state, error: result.error };
    const actor = s.residents.find(person => person.id === cmd.residentId)!;
    log(s, "social", result.event.title, result.event.text, [actor]);
    const entry = s.logs[s.logs.length - 1];
    entry.actors.push("village-trader");
    entry.witnesses.push("village-trader");
    return { state: s };
  }
  if (cmd.type === "guard-agreement") {
    const preview = inspectGuardAgreement(state, cmd.residentIds);
    if (preview.error) return { state, error: preview.error };
    const actor = s.residents.find(r => r.id === preview.actorId)!;
    ensureInventory(s).packs[actor.id].food -= GUARD_AGREEMENT_RULE.cost.food;
    clearAutomaticBattleActions(s, new Set(), "ruins-guard");
    if (!getCombatGroups(s).some(group => group.encounter.id === "ridge-watch")) delete s.pauseReason;
    log(s, "social", "置き場を譲り受けた", `${actor.name}が携えてきた食事3食を渡した。守り手は食事を受け取り、置き場を譲って立ち去った。残る物資の回収や帰路は、改めて選べる。`, [actor]);
    const entry = s.logs[s.logs.length - 1];
    entry.actors.push(GUARD_AGREEMENT_RULE.counterpartId);
    entry.witnesses.push(GUARD_AGREEMENT_RULE.counterpartId);
    entry.guardAgreement = { ruleId: GUARD_AGREEMENT_RULE.id, location: GUARD_AGREEMENT_RULE.location };
    s.guardAgreement = { version: 1, ...entry.guardAgreement, actorId: actor.id, agreedAt: s.minutes, logId: entry.id };
    return { state: s };
  }
  if (cmd.type === "food-production-target") {
    const result = setFoodProductionTarget(s, cmd.target);
    if (result.error) return { state, error: result.error };
    return { state: result.changed ? s : state };
  }
  if (cmd.type === "save-selection-preset" || cmd.type === "delete-selection-preset") {
    const result = cmd.type === "save-selection-preset"
      ? saveSelectionPreset(s, cmd)
      : deleteSelectionPreset(s, cmd.presetId);
    if (result.error) return { state, error: result.error };
    return { state: result.changed ? s : state };
  }
  if (cmd.type === "plan-trip" || cmd.type === "close-trip") {
    const result = cmd.type === "plan-trip"
      ? saveTravelPlan(s, cmd)
      : closeTravelPlan(s, cmd.planId);
    if (result.error) return { state, error: result.error };
    return { state: result.changed ? s : state };
  }
  if (cmd.type === "recruit") {
    if (s.ended) return { state, error: "この試行は終了しています。" };
    s.version = s.version === 5 ? 5 : s.secondaryEncounter ? 4 : 3;
    initializeResidentProfiles(s);
    const result = recruitCompanion(s, cmd.residentId, cmd.npcId);
    return result.error ? { state, error: result.error } : { state: s };
  }
  if (cmd.type === "routine") {
    const actor = s.residents.find((person) => person.id === cmd.residentId);
    if (!actor) return { state, error: "住民が見つかりません。" };
    if (actor.id === "aki") return { state, error: "アキはあなたの直接指示で行動します。" };
    if (!validRoutine(cmd.routine)) return { state, error: "暮らしの担当設定が不正です。" };
    actor.routine = { ...cmd.routine };
    return { state: s };
  }
  if (cmd.type === "transfer-coins") {
    const preview = inspectCoinTransfer(s, cmd.residentId, cmd.from, cmd.to, cmd.amount);
    if (preview.error) return { state, error: preview.error };
    const actor = s.residents.find((p) => p.id === cmd.residentId)!;
    const sourceName = s.residents.find((p) => p.id === cmd.from)!.name;
    const targetName = s.residents.find((p) => p.id === cmd.to)!.name;
    log(s, "work", "銀貨の受渡し", `${actor.name}が${sourceName}の銀貨${cmd.amount}枚を${targetName}へ移した。`, [actor]);
    const entry = s.logs[s.logs.length - 1];
    entry.coinTransfer = { from: cmd.from, to: cmd.to, amount: cmd.amount, location: actor.location };
    const currency = s.currency ??= { version: 1, transfers: [] };
    currency.transfers.push({ logId: entry.id, time: s.minutes, location: actor.location, actorId: actor.id,
      from: cmd.from, to: cmd.to, amount: cmd.amount });
    return { state: s };
  }
  if (cmd.type === "transfer" || cmd.type === "region") {
    if (s.ended) return { state, error: "この試行は終了しています。" };
    if (cmd.type === "transfer") {
      const error = transferResources(s, cmd.residentId, cmd.from, cmd.to, cmd.resource, cmd.amount);
      if (error) return { state, error };
      const actor = s.residents.find((p) => p.id === cmd.residentId)!;
      const labels = { food: "食事", ingredients: "食材", medicine: "手当用品", scrap: "資材" };
      const sourceName = cmd.from === "base" ? "拠点倉庫" : cmd.from === "ground" ? "足元" : s.residents.find((p) => p.id === cmd.from)?.name ?? cmd.from;
      const targetName = cmd.to === "base" ? "拠点倉庫" : cmd.to === "ground" ? "足元" : s.residents.find((p) => p.id === cmd.to)?.name ?? cmd.to;
      log(s, "work", "荷物の受渡し", `${actor.name}が${sourceName}から${targetName}へ${labels[cmd.resource]}${cmd.amount}を移した。`, [actor]);
    } else {
      const result = applyRegionInteraction(s, cmd.residentId, cmd.npcId, cmd.choice);
      if (result.error) return { state, error: result.error };
      const actor = s.residents.find((p) => p.id === cmd.residentId)!;
      log(s, "social", result.title ?? "集落でのやり取り", result.text ?? "", [actor]);
      const entry = s.logs[s.logs.length - 1];
      entry.actors = [...new Set([...entry.actors, cmd.npcId])];
      entry.witnesses = [...new Set([...entry.witnesses, cmd.npcId])];
      if (isCoinChoice(cmd.choice)) {
        entry.coinTrade = { choice: cmd.choice, termsId: VILLAGE_COINS_TERMS_ID };
        const receipt = s.region!.receipts[s.region!.receipts.length - 1];
        if (isCoinChoice(receipt.choice)) receipt.logId = entry.id;
      } else if (cmd.choice === "report-agreement") {
        entry.reportedGuardAgreementId = s.guardAgreement!.logId;
        const receipt = s.region!.receipts[s.region!.receipts.length - 1];
        if (receipt.choice === "report-agreement") receipt.logId = entry.id;
      }
    }
    return { state: s };
  }
  if (cmd.type === "trade") {
    const failTrade = (error: string) => ({ state, error });
    if ((cmd.allowLowFood !== undefined && typeof cmd.allowLowFood !== "boolean")
      || (cmd.confirmationKey !== undefined && typeof cmd.confirmationKey !== "string")) return failTrade("交換の確認内容が不正です。");
    const preview = previewTrade(state, [cmd.residentId], cmd.visitId, cmd.offerId);
    if (preview.error) return failTrade(preview.error);
    if (cmd.allowLowFood === true && cmd.confirmationKey !== preview.confirmationKey)
      return failTrade("交換の条件が変わりました。現在の在庫と交換後の食料を確認し直してください。");
    if (preview.warning && cmd.allowLowFood !== true) return failTrade(preview.warning);
    const offer = getMerchantOffers(state).find((candidate) => candidate.id === cmd.offerId)!;
    for (const key of RESOURCE_KEYS) s.resources[key] += (offer.received[key] ?? 0) - (offer.paid[key] ?? 0);
    s.trade!.visit!.stock[offer.stockKey] -= offer.received[offer.stockKey] ?? 0;
    s.trade!.receipts.push({ id: s.nextId++, visitId: cmd.visitId, actorId: cmd.residentId, time: s.minutes,
      offerId: offer.id, termsId: preview.termsId!, paid: { ...offer.paid }, received: { ...offer.received },
      ...(preview.warning ? { lowFoodConfirmed: true } : {}) });
    const actor = s.residents.find((r) => r.id === cmd.residentId)!;
    const paid = offer.paid.food ? `食事${offer.paid.food}食` : `食材${offer.paid.ingredients}個`;
    const received = offer.received.scrap ? `資材${offer.received.scrap}個` : `手当用品${offer.received.medicine}個`;
    log(s, "work", "物々交換", `${actor.name}が${paid}を渡し、${received}を受け取った。`, [actor]);
    return { state: s };
  }
  delete s.pauseReason;
  const fail = (error: string) => ({ state, error });
  if (s.ended && cmd.type !== "policy")
    return fail(
      "この試行は終了しました。保存データを読み込むか、同じ朝からやり直してください。",
    );
  if (cmd.type === "auto-combat") {
    if (typeof cmd.enabled !== "boolean")
      return fail("自動戦闘の設定が不正です。");
    s.autoCombat = cmd.enabled;
    if (!cmd.enabled) clearAutomaticBattleActions(s);
    return { state: s };
  }
  if (cmd.type === "discuss-craft") {
    if (!Number.isSafeInteger(cmd.craftId) || cmd.craftId < 1)
      return fail("紹介する作品を選んでください。");
    if (!Array.isArray(cmd.residentIds) || cmd.residentIds.some((id) => typeof id !== "string"))
      return fail("作者と相手を、住民一覧で二人選んでください。");
    const selected = [...new Set(cmd.residentIds)];
    if (selected.length !== 2)
      return fail("作品の作者と相手を、住民一覧で二人だけ選んでください。");
    const craft = s.life?.crafts.find((piece) => piece.id === cmd.craftId);
    if (!craft || craft.createdAt > s.minutes || craft.id >= s.nextId)
      return fail("紹介する作品が見つかりません。");
    if (!selected.includes(craft.authorId))
      return fail("作品の作者と、紹介する相手を選んでください。");
    const author = s.residents.find((person) => person.id === craft.authorId);
    const viewer = s.residents.find((person) => selected.includes(person.id) && person.id !== craft.authorId);
    if (!author || !viewer) return fail("選択した住民が見つかりません。");
    const people = [author, viewer];
    if (people.some((person) => person.hp <= 0 || person.action?.kind === "sleep"))
      return fail("二人が起きてから、作品を紹介できます。");
    if (!atBase(author) || viewer.location !== author.location)
      return fail("作品の作者と相手が、拠点の同じ部屋にいる必要があります。");
    const presenceProblem = craftPresenceProblem(s, craft, author.location);
    if (presenceProblem) return fail(presenceProblem);
    // Stage both participants before making either reciprocal job. All failure
    // paths return the untouched input, including ids and old reservations.
    for (const person of people) {
      if (person.action && !person.action.automatic) {
        if (person.suspended) return fail(`${person.name}には中断中の仕事があります。再開または取り消しを選んでください。`);
        person.suspended = person.action;
      }
      person.action = null;
    }
    const jobs: Action[] = [];
    for (let index = 0; index < people.length; index++) {
      const person = people[index], peer = people[1 - index];
      const job = makeAction(s, person, "socialize", peer.id);
      if (typeof job === "string") return fail(job);
      job.label = index === 0 ? `${peer.name}に作品を紹介する` : `${peer.name}の作品を見る`;
      jobs.push(job);
    }
    for (let index = 0; index < people.length; index++) {
      jobs[index].topic = { kind: "craft", craftId: craft.id, peerActionId: jobs[1 - index].id };
      people[index].action = jobs[index];
    }
    return { state: s };
  }
  if (cmd.type === "assign") {
    if (cmd.encounterId !== undefined && (!Array.isArray(cmd.residentIds) || !["attack", "defend"].includes(cmd.kind)
      || !["ruins-guard", "ridge-watch"].includes(cmd.encounterId))) return fail("攻撃・防御の相手を確認してください。");
    if (cmd.encounterId === "ridge-watch" && (cmd.target !== undefined || cmd.via !== undefined || cmd.cargo !== undefined || cmd.subjectEventId !== undefined))
      return fail("第二の相手への攻撃・防御を選んでください。");
    if (cmd.kind === "approach-ridge") {
      const preview = inspectRidgeApproach(state, cmd.residentIds);
      if (preview.error) return fail(preview.error);
      if (cmd.target !== undefined || cmd.via !== undefined || cmd.cargo !== undefined || cmd.subjectEventId !== undefined)
        return fail("人影への接近には、尾根にいる一人を選んでください。");
    }
    if (cmd.kind === "repair-route" && (!Array.isArray(cmd.residentIds) || new Set(cmd.residentIds).size !== 1))
      return fail("道を整備する住民を、住民一覧で一人だけ選んでください。");
    if (cmd.via !== undefined && (cmd.kind !== "move" || !Array.isArray(cmd.via) || cmd.via.length > 10 || cmd.via.some((id) => !isLocation(id)))) return fail("移動の道順を確認してください。");
    if (cmd.cargo !== undefined && (!validMoveCargo(cmd.cargo) || cmd.kind !== "move" || cmd.target !== "home"
      || cmd.subjectEventId !== undefined || !Array.isArray(cmd.residentIds) || new Set(cmd.residentIds).size !== 1))
      return fail("倉庫への運搬は、一人と手持ちの一種類・1以上の整数を選んでください。");
    if (!cmd.residentIds.length) return fail("指示する住民を選んでください。");
    if (cmd.subjectEventId !== undefined && new Set(cmd.residentIds).size !== 1)
      return fail("題材を選んで作る住民を、一人だけ選んでください。");
    for (const id of [...new Set(cmd.residentIds)]) {
      const r = s.residents.find((x) => x.id === id);
      if (!r) return fail("住民が見つかりません。");
      if (cmd.cargo !== undefined && atBase(r))
        return fail("倉庫への運搬は野外から指示します。拠点内では荷物を直接しまえます。");
      if (cmd.kind === "observe" && r.action?.kind === "sleep")
        return fail(`${r.name}は眠っています。起きてから景色を眺められます。`);
      if (cmd.kind === "sleep") {
        const problem = inspectSleep(s, r.id).error;
        if (problem) return fail(problem);
        if (r.action?.kind === "sleep") continue;
        if (r.suspended?.kind === "sleep" && (!r.action || r.action.automatic)) {
          if (!r.suspended.origin && !atBase(r))
            return fail("寝場所が記録されていない以前の睡眠は、拠点で再開してください。");
          if (r.suspended.origin && r.suspended.origin !== r.location)
            return fail("中断した場所へ戻ってから再開してください。");
          r.action = r.suspended;
          r.suspended = null;
          continue;
        }
      }
      if (
        !atBase(r) && s.residents.some(
          (x) =>
            x.id !== r.id &&
            x.hp > 0 && validRescueTarget(x, r) &&
            [x.action, x.suspended].some(
              (t) => t?.kind === "rescue" && t.target === r.id,
            ),
        )
      )
        return fail(
          `${r.name}は救助・運搬中です。運搬を終えるか、救助する住民の行動を取り消してください。`,
        );
      // An interrupted explicit task retains its reservation. Automatic tasks may be replaced.
      if (r.action && !r.action.automatic) {
        if (r.suspended)
          return fail(
            `${r.name}には中断中の仕事があります。再開または取り消しを選んでください。`,
          );
        r.suspended = r.action;
        r.action = null;
      } else r.action = null;
      const a = makeAction(s, r, cmd.kind, cmd.target, false, cmd.subjectEventId, cmd.encounterId);
      if (typeof a === "string") return fail(a);
      if (a.kind === "move" && cmd.via?.length && isLocation(cmd.target)) {
        const index = cmd.via.lastIndexOf(r.location);
        const waypoints = [...(index >= 0 ? cmd.via.slice(index + 1) : cmd.via), cmd.target];
        const path: LocationId[] = [];
        let from = r.location;
        for (const point of waypoints) {
          if (point === from) continue;
          const part = pathBetween(s, from, point);
          if (!part.length) return fail("その道順では移動できません。");
          path.push(...part); from = point;
        }
        a.path = path;
        let prior = r.location;
        a.duration = path.reduce((sum, next) => { const cost = edgeDuration(prior, next, r, s); prior = next; return sum + cost; }, 0);
        a.segmentDuration = edgeDuration(r.location, path[0], r, s);
      }
      if (cmd.cargo !== undefined) {
        // The old automatic job has been replaced, or explicit work is now held.
        // Only the owner's remaining pack may back this new reservation.
        if (ownFreeResources(s, r.id)[cmd.cargo.resource] < cmd.cargo.amount)
          return fail(`${r.name}の手持ちの未予約${RESOURCE_NAMES[cmd.cargo.resource]}が足りません。`);
        a.cargo = { ...cmd.cargo };
        a.reserved = { [cmd.cargo.resource]: cmd.cargo.amount };
        a.reservationSource = "pack";
        a.label = `${cargoLabel(cmd.cargo)}を倉庫へ届ける`;
      }
      r.action = a;
      if (a.materialTransfers?.length) {
        const origins = [...new Set(a.materialTransfers.map((entry) => entry.from === "base" ? "拠点倉庫" : s.residents.find((p) => p.id === entry.from)?.name ?? entry.from))].join("・");
        log(s, "work", "必要な物資を確保", `${r.name}が${origins}から、${a.label}に使う物資を自分の荷物へ確保した。`, [r]);
      }
      if (a.kind === "rescue") {
        const carried = s.residents.find((x) => x.id === a.target);
        if (carried?.action) {
          const interrupted = carried.action;
          if (
            !carried.suspended &&
            !carried.action.automatic &&
            !["attack", "defend"].includes(carried.action.kind)
          )
            carried.suspended = carried.action;
          // The dedicated local work can stay blocked in current when the
          // older held slot is occupied. Rescue never cancels its reservation.
          if (!["repair-route", "approach-ridge"].includes(interrupted.kind) || carried.suspended?.id === interrupted.id) carried.action = null;
          if (interrupted.cargo && carried.suspended?.id !== interrupted.id)
            stopCargo(s, carried, interrupted, "救助を受けるため、運搬を続けられない。 ");
        }
      }
    }
    return { state: s };
  }
  const r = s.residents.find((x) => x.id === cmd.residentId);
  if (!r) return fail("住民が見つかりません。");
  if (cmd.type === "policy") {
    r.policy = cmd.policy;
    return { state: s };
  }
  if (cmd.type === "equip") {
    if (!atBase(r) || r.hp <= 0)
      return fail("装備の変更は、拠点で意識のある住民が行えます。");
    const equipmentError = changeEquipment(s, r, cmd.weapon, cmd.armor);
    if (equipmentError) return fail(equipmentError);
    return { state: s };
  }
  if (cmd.type === "pause") {
    if (!r.action) return fail("進行中の行動がありません。");
    if (r.suspended)
      return fail(
        "すでに中断中の行動があります。先に取り消すか再開してください。",
      );
    r.suspended = r.action;
    r.action = null;
    return { state: s };
  }
  if (cmd.type === "cancel") {
    const cancelled = cmd.actionId !== undefined
      ? [r.action, r.suspended].find((a) => a?.id === cmd.actionId) : r.action ?? r.suspended;
    if (cancelled?.topic) {
      const peer = getCraftConversationPeer(s, r, cancelled);
      const sceneIds = new Set([cancelled.id, ...(peer ? [peer.action.id] : [])]);
      for (const person of s.residents) {
        if (person.action && sceneIds.has(person.action.id)) person.action = null;
        if (person.suspended && sceneIds.has(person.suspended.id)) person.suspended = null;
      }
      return { state: s };
    }
    if (cancelled?.automatic && cancelled.kind === "move" && cancelled.autonomyReason && atBase(r)) recordManualStay(s, r, "cancel");
    if (cmd.actionId !== undefined) {
      if (r.action?.id === cmd.actionId) r.action = null;
      else if (r.suspended?.id === cmd.actionId) r.suspended = null;
      else
        return fail(
          "指定した行動はすでに終了または取り消されています。現在の行動を確認してください。",
        );
    } else {
      if (r.action) r.action = null;
      else if (r.suspended) r.suspended = null;
      else return fail("取り消す行動がありません。");
    }
    return { state: s };
  }
  if (cmd.type === "resume") {
    if (!r.suspended) return fail("中断中の行動がありません。");
    if (r.hp <= 0) return fail("意識が戻るまで再開できません。");
    if (r.action && !r.action.automatic)
      return fail("現在の行動を終えるか取り消してから再開してください。");
    if (["attack", "defend"].includes(r.suspended.kind)) {
      const encounter = getEncounter(s, actionEncounterId(r.suspended));
      if (!encounter?.present || encounter.location !== r.location) return fail(encounter?.present
        ? "相手のいる場所へ戻ってから、攻撃・防御を再開してください。"
        : "相手はもう退いています。中断した攻撃・防御を取り消し、別の行動を選んでください。");
    }
    if (r.suspended.kind === "approach-ridge") {
      const problem = ridgeApproachProblem(s, r, r.suspended);
      if (problem) return fail(problem);
    }
    if (r.suspended.cargo) {
      if (s.residents.some(carrier => carrier.id !== r.id && carrier.hp > 0 && validRescueTarget(carrier, r)
        && [carrier.action, carrier.suspended].some(job => job?.kind === "rescue" && job.target === r.id)))
        return fail(`${r.name}は救助・運搬中です。救助が終わってから荷物の運搬を確認してください。`);
      if (atBase(r)) {
        // Another route or a rescuer already brought the person home. This is
        // only an explicit local handoff, never a second walking/return event.
        const error = depositCargo(s, r, r.suspended);
        if (error) return fail(error);
        r.suspended = null;
        r.action = null;
        return { state: s };
      }
    }
    if (r.suspended.topic && !getCraftConversationPeer(s, r, r.suspended))
      return fail("一緒に見る相手の行動を確認できません。紹介を取り消し、二人を選び直してください。");
    if (r.suspended.subjectEventId !== undefined && !validCraftSubjectReference(
      s, r.id, r.suspended.subjectEventId, r.suspended.id, s.minutes,
    )) return fail("この作品の題材を確認できません。元の行動を取り消し、題材を選び直してください。");
    if (
      !["move", "rescue"].includes(r.suspended.kind) &&
      r.suspended.origin &&
      r.location !== r.suspended.origin
    )
      return fail("中断した場所へ戻ってから再開してください。");
    if (
      [
        "cook",
        "hobby",
        "decorate",
        "place-craft",
        "project",
        "rest",
        "socialize",
        "help",
      ].includes(r.suspended.kind) &&
      !atBase(r) && !(r.location === "lodge" && lodgeWork(r.suspended.kind, r.suspended.target))
    )
      return fail("拠点へ戻ってから再開してください。");
    if (r.suspended.kind === "sleep") {
      if (!r.suspended.origin && !atBase(r))
        return fail("寝場所が記録されていない以前の睡眠は、拠点で再開してください。");
      const problem = inspectSleep(s, r.id).error;
      if (problem) return fail(problem);
    }
    if (["eat", "heal"].includes(r.suspended.kind) && !atBase(r) && getPresentEncounterAt(s, r.location)) return fail("交戦中は食事や手当を再開できません。");
    if (r.suspended.kind === "rescue") {
      const carried = s.residents.find((x) => x.id === r.suspended?.target);
      if (carried && atBase(carried))
        return fail("その仲間はすでに拠点内です。中断した救助を取り消し、必要な手当を確認してください。");
      if (
        !carried ||
        carried.id === r.id ||
        carried.location !== r.location ||
        carried.hp > 35 ||
        r.hp < 30 ||
        r.wounds.arm >= 3
      )
        return fail(
          "救助を再開できません。対象の場所と救助する住民の体調を確認してください。",
        );
      if (s.residents.some((other) => other.id !== r.id && other.hp > 0 && validRescueTarget(other, r)
        && [other.action, other.suspended].some((job) => job?.kind === "rescue" && job.target === r.id)))
        return fail(`${r.name}は救助・運搬中です。運搬を終えるか、救助する住民の行動を取り消してください。`);
      if (
        s.residents.some(
          (x) =>
            x.id !== r.id &&
            x.hp > 0 && validRescueTarget(x, carried) &&
            [x.action, x.suspended].some(
              (t) => t?.kind === "rescue" && t.target === carried.id,
            ),
        )
      )
        return fail("その仲間は別の住民が救助中です。");
    }
    if (r.suspended.kind === "help") {
      const original = s.residents.find((x) => x.id === r.suspended?.target);
      if (r.suspended.targetActionId === undefined)
        return fail("以前の保存では手伝う作業を特定できません。取り消して、今の仕事へ指示し直してください。");
      if (!original || original.hp <= 0 || original.location !== r.location
        || original.action?.id !== r.suspended.targetActionId
        || !HELPABLE_ACTIONS.includes(original.action.kind))
        return fail("手伝う予定だった仕事は、今ここで進んでいません。元の仕事を再開するか、手伝いを取り消してください。");
    }
    if (r.suspended.kind === "gather") {
      if (isHarvestLocation(r.location) && !regionHarvestAvailable(s, r.location))
        return fail("今日の収穫は済んでいます。翌日、この場所で再開できます。");
      if (recoveredCache(s, r.location))
        return fail("この場所の物資はすでに回収されています。残りの回収作業を取り消してください。裏庭では食材を集められます。");
      if (guardedCache(s, r.location))
        return fail("この場所には物資を守る流れ者がいます。先に戦闘か撤退を確認してください。");
    }
    if (r.suspended.kind === "observe") {
      const problem = observationProblem(s, r, r.suspended);
      if (problem) return fail(problem);
    }
    if (r.suspended.kind === "repair-route") {
      const problem = getRouteWorkProblem(s, r, r.suspended);
      if (problem) return fail(problem);
    }
    if (r.suspended.kind === "move") {
      const expected = r.suspended.segment
        ? r.suspended.path?.[r.suspended.segment - 1]
        : r.suspended.origin;
      if (expected && r.location !== expected) {
        if (r.location === r.suspended.target) {
          r.suspended = null;
          return { state: s };
        }
        const replanned = makeAction(s, r, "move", r.suspended.target);
        if (typeof replanned === "string") return fail(replanned);
        if (r.suspended.cargo) {
          // Retain its existing lock exactly once, not a second free-stock test.
          replanned.cargo = { ...r.suspended.cargo };
          replanned.reserved = { ...r.suspended.reserved };
          replanned.reservationSource = "pack";
          replanned.label = `${cargoLabel(replanned.cargo)}を倉庫へ届ける`;
        }
        r.suspended = replanned;
      }
    }
    if (["move", "rescue"].includes(r.suspended.kind) && r.suspended.path) {
      const job = r.suspended;
      const routeState = { ...s, residents: s.residents.map((person) => person.id === r.id ? { ...person, action: job } : person) };
      const index = job.segment ?? 0;
      if ((job.segmentProgress ?? 0) === 0) job.segmentDuration = edgeDuration(r.location, job.path![index], r, routeState);
      let from = job.path![index];
      job.duration = job.progress + Math.max(0, (job.segmentDuration ?? 1) - (job.segmentProgress ?? 0))
        + job.path!.slice(index + 1).reduce((sum, next) => { const cost = edgeDuration(from, next, r, routeState); from = next; return sum + cost; }, 0);
    }
    r.action = r.suspended;
    r.suspended = null;
    return { state: s };
  }
  return fail("対応していない指示です。");
}
export function previewTrade(state: GameState, residentIds: string[], visitId: number | undefined, offerId: string): TradePreview {
  return inspectTrade(state, residentIds, visitId, offerId, availableResources(state));
}
export function tradeSelection(state: GameState, residentIds: string[], visitId: number, offerId: import("./types").TradeOfferId, intent: TradeIntent = {}): { state: GameState; error?: string } {
  if (residentIds.length !== 1) return { state, error: "交換する住民を、ホームの一覧で一人だけ選んでください。" };
  return command(state, { type: "trade", residentId: residentIds[0], visitId, offerId,
    allowLowFood: intent.allowLowFood, confirmationKey: intent.confirmationKey });
}
function bond(a: Resident, b: Resident, closeness = 4, trust = 2) {
  if (a.id === b.id) return;
  const rel = a.relations[b.id];
  if (rel) {
    rel.closeness = clamp(rel.closeness + closeness);
    rel.trust = clamp(rel.trust + trust);
  }
}
function consume(s: GameState, r: Resident, a: Action) {
  consumeActionResources(s, r, a);
}
function finishConversation(s: GameState, r: Resident, a: Action, due: Set<number>, revivedIds: Set<string>, topicAttention: ReadonlySet<string>) {
  const jobs = [{ resident: r, action: a }, ...s.residents.filter((p) => p.id !== r.id
    && p.action?.kind === "socialize" && !p.action.topic && due.has(p.action.id)).map((p) => ({ resident: p, action: p.action! }))];
  const involved = new Set([r.id, ...(a.target ? [a.target] : [])]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const job of jobs) if (involved.has(job.resident.id) || (job.action.target && involved.has(job.action.target))) {
      for (const id of [job.resident.id, job.action.target]) if (id && !involved.has(id)) { involved.add(id); changed = true; }
    }
  }
  const members = jobs.filter((job) => involved.has(job.resident.id));
  const people = s.residents.filter((p) => involved.has(p.id));
  const possible = people.length >= 2 && people.every((p) => !revivedIds.has(p.id) && !topicAttention.has(p.id)
    && p.hp > 0 && p.location === r.location && p.action?.kind !== "sleep")
    && members.every((job) => {
      const target = s.residents.find((p) => p.id === job.action.target);
      return !!target && !target.action?.topic && (!target.action || !CONVERSATION_BLOCKERS.includes(target.action.kind))
        && (!job.action.automatic || !target.action || (target.action.kind === "socialize" && involved.has(target.action.target ?? "")));
    });
  for (const job of members) if (job.resident.action?.id === job.action.id) job.resident.action = null;
  if (!possible) {
    log(s, "system", "会話はおあずけ", `${r.name}は相手の様子を確かめた。今は話を続けられないため、ここで切り上げた。`, [r]);
    return;
  }
  recordConversation(s, people);
}

/** Daily relationship/mood caps are shared by generic and explicitly chosen scenes. */
function recordConversation(s: GameState, people: Resident[], craftId?: number) {
  const history = ensureAutonomy(s);
  const sharedCraft = craftId === undefined ? undefined : s.life?.crafts.find((piece) => piece.id === craftId);
  const day = Math.floor(s.minutes / 1440) + 1;
  const pairs: [Resident, Resident][] = [];
  for (let i = 0; i < people.length; i++) for (let j = i + 1; j < people.length; j++) {
    const last = history.conversations[pairKey(people[i].id, people[j].id)];
    if (!last || s.minutes - last.time >= 20) pairs.push([people[i], people[j]]);
  }
  // A resumed explicit scene remains a fact even when recent generic contact
  // suppresses its rewards. Generic overlapping orders still form one scene.
  if (!pairs.length && !sharedCraft) return;
  const report = sharedCraft ? undefined : selectConversationReport(s, people.map((p) => p.id));
  const known = [...(s.life?.events ?? [])].reverse().find((e) => {
    const objectId = e.topic?.kind === "craft" ? e.topic.craftId
      : ["craft", "display"].includes(e.kind) ? e.craftId : undefined;
    return objectId !== undefined ? people.every((p) => knowsCraft(s, p.id, objectId))
      : (e.kind === "rescue" || isOutdoorQuiet(e)) && people.every((p) => knowsLifeEvent(s, p.id, e.id));
  });
  const rememberedCraftId = known?.topic?.craftId ?? known?.craftId;
  const rememberedCraft = rememberedCraftId === undefined ? undefined : s.life?.crafts.find((piece) => piece.id === rememberedCraftId);
  const topic = known?.kind === "rescue" ? "帰り道のこと"
    : known && isOutdoorQuiet(known) ? `${sceneryName(known.location)}の景色のこと`
    : rememberedCraft ? `${getCraftDisplayTitle(s, rememberedCraft)}のこと` : "これからの暮らし";
  const event = recordExperience(s, "conversation", people.map((p) => p.id), {
    text: sharedCraft
      ? `${people.map((p) => p.name).join("と")}が、作品の前で言葉を交わした。`
      : report ? `${people.map((p) => p.name).join("と")}が、同じ場所で言葉を交わした。`
      : `${people.map((p) => p.name).join("と")}が、同じ場所で${topic}を話した。`,
  });
  if (report) event.report = report;
  if (sharedCraft) event.topic = { kind: "craft", craftId: sharedCraft.id };
  const mood = new Map<string, number>();
  for (const [first, second] of pairs) {
    const key = pairKey(first.id, second.id);
    const previous = history.conversations[key];
    const count = previous?.day === day ? previous.count : 0;
    const closeness = count === 0 ? 4 : count === 1 ? 1 : 0;
    const trust = count === 0 ? 1 : 0;
    bond(first, second, closeness, trust); bond(second, first, closeness, trust);
    for (const p of [first, second]) mood.set(p.id, Math.max(mood.get(p.id) ?? 0, count === 0 ? 8 : count === 1 ? 2 : 0));
    history.conversations[key] = { day, count: count + 1, time: s.minutes, eventId: event.id };
  }
  for (const p of people) p.mood = clamp(p.mood + (mood.get(p.id) ?? 0));
  log(s, "social", sharedCraft ? "二人で見る作品" : people.length === 3 ? "三人のひととき" : people.length > 3 ? "みんなのひととき" : "少しだけ、近くに",
    sharedCraft
      ? `${people[0].name}が${people[1].name}に、自分の${getCraftDisplayTitle(s, sharedCraft)}を紹介した。二人はその作品を見ながら話した。`
      : report ? getLifeExperienceText(s, event, report.listenerId)
      : `${people.map((p) => p.name).join("と")}は、同じ場所で${topic}を少し話した。それぞれの過ごし方を確かめる、穏やかな時間になった。`,
    people, true, report || sharedCraft ? (resident) => getLifeExperienceText(s, event, resident.id) : undefined);
}

/** due is fixed before either resident increments: the peer may still be 19/20. */
function finishCraftConversation(s: GameState, r: Resident, a: Action, due: Set<number>, revivedIds: Set<string>) {
  const peer = getCraftConversationPeer(s, r, a);
  const craft = s.life?.crafts.find((piece) => piece.id === a.topic?.craftId);
  if (!peer || !craft || !due.has(a.id) || !due.has(peer.action.id)
    || r.action?.id !== a.id || peer.resident.action?.id !== peer.action.id
    || [r, peer.resident].some((person) => revivedIds.has(person.id) || person.hp <= 0
      || person.location !== a.origin)
    || !a.origin || craftPresenceProblem(s, craft, a.origin)) return;
  r.action = null;
  peer.resident.action = null;
  const people = [r, peer.resident].sort((first) => first.id === craft.authorId ? -1 : 1);
  recordConversation(s, people, craft.id);
}
/** One finite cache, with only the workers who truly complete in this minute. */
function finishFiniteGather(s: GameState, r: Resident, due: Set<number>) {
  const collectors = [r, ...s.residents.filter((other) => other.id !== r.id && other.hp > 0
    && other.location === r.location && other.action?.kind === "gather" && due.has(other.action.id))]
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  for (const collector of collectors) collector.action = null;
  const names = collectors.map((person) => person.name).join("と");
  if (recoveredCache(s, r.location)) {
    log(s, "system", "物資は回収済み", `${names}は、物資がすでに回収されたため、残りの作業をここで切り上げた。`, collectors);
    return;
  }
  if (guardedCache(s, r.location)) {
    log(s, "system", "回収を見合わせた", `${names}は、物資を守る流れ者がいるため回収を見合わせた。先に周囲の安全を確かめたい。`, collectors);
    return;
  }
  const safe = r.location === "shelter";
  addResourcesAt(s, collectors[0], { scrap: safe ? 3 : 8, ingredients: safe ? 2 : 4, ...(safe ? {} : { medicine: 2 }) });
  if (safe) s.flags.safeSuppliesRecovered = true;
  else { s.flags.suppliesRecovered = true; }
  const text = safe
    ? `${names}が木陰の迂回路で物資を回収した。回収材3個と食材2個を確保した。`
    : `${names}が資材置き場で回収材8個、食材4個、手当用品2個を確保した。`;
  recordExperience(s, "supply", collectors.map((person) => person.id), { location: r.location, text });
  log(s, "explore", safe ? "争わずに得たもの" : "物資を確保した", text, collectors, true);
}

/** A moment belongs only to people who truly finish here in this minute. */
function finishObservation(s: GameState, r: Resident, a: Action, due: Set<number>) {
  const problem = observationProblem(s, r, a);
  if (problem || r.hp <= 0) {
    stopObservation(s, r, problem ?? "意識と体調を確かめてから、また選べます。");
    return;
  }
  const people = [r, ...s.residents.filter((other) => other.id !== r.id
    && other.hp > 0 && other.location === r.location
    && other.action?.kind === "observe" && due.has(other.action.id)
    && !observationProblem(s, other, other.action))]
    .sort((first, second) => first.id.localeCompare(second.id));
  for (const person of people) person.action = null;
  const names = people.map((person) => person.name).join("と");
  const text = `${names}は${sceneryName(r.location)}で、景色を眺めて過ごした。`;
  recordExperience(s, "quiet", people.map((person) => person.id), { location: r.location, text });
  log(s, "explore", "景色を眺めて", text, people, true);
}

function finish(s: GameState, r: Resident, a: Action, due: Set<number>, revivedIds: Set<string>, topicAttention: ReadonlySet<string>, contactedEncounterIds: Set<EncounterId>) {
  if (a.kind === "approach-ridge") {
    const problem = ridgeApproachProblem(s, r, a);
    if (problem) { holdRidgeApproach(s, r, a, problem); return; }
    r.action = null;
    s.version = s.version === 5 ? 5 : 4;
    s.secondaryEncounter = { version: 1, hp: SECOND_ENCOUNTER_RULE.maxHp, defeated: false, alerted: true,
      introducedAt: s.minutes, actorId: r.id, logId: s.nextId };
    const encounter = getEncounter(s, "ridge-watch")!;
    log(s, "explore", "尾根の見張り", `${r.name}が尾根の人影へ近づくと、見張りが道へ出てきた。相手の出方を確かめ、戦うか、退路を選べる。`, [r], true, undefined, encounter);
    contactedEncounterIds.add(encounter.id);
    s.pauseReason = `${r.name}が尾根の見張りと遭遇しました。戦闘・防御・撤退を選んでください。`;
    return;
  }
  const peer = s.residents.find((x) => x.id === a.target);
  if (a.kind === "repair-route") {
    const problem = getRouteWorkProblem(s, r, a);
    if (problem) { holdRouteWork(s, r, a, problem); return; }
    consume(s, r, a);
    r.action = null;
    log(s, "work", "川沿いの道を整えた", `${r.name}が手持ちの資材2個を使い、集落へ続く川沿いの道を整えた。行き来が少し楽になった。`, [r]);
    const entry = s.logs[s.logs.length - 1];
    entry.routeWork = { ruleId: RIVER_PATH_RULE.id, location: RIVER_PATH_RULE.location };
    s.routeWorks = { version: 1, riverPath: { ruleId: RIVER_PATH_RULE.id, actorId: r.id,
      location: RIVER_PATH_RULE.location, completedAt: s.minutes, logId: entry.id } };
    return;
  }
  if (a.topic?.kind === "craft") {
    finishCraftConversation(s, r, a, due, revivedIds);
    return;
  }
  if (a.kind === "observe") {
    finishObservation(s, r, a, due);
    return;
  }
  if (a.subjectEventId !== undefined && !validCraftSubjectReference(
    s, r.id, a.subjectEventId, a.id, s.minutes,
  )) {
    r.action = null;
    log(s, "system", "題材を確かめてから", `${r.name}は題材を確認できないため、制作を見合わせた。材料は使わずに残した。`, [r]);
    return;
  }
  if (a.kind === "rescue" && !validRescueTarget(r, peer)) {
    r.action = null;
    log(s, "system", "救助を見合わせた", `${r.name}は、対象の場所や体調が変わったため救助を切り上げた。帰宅済みなら手当を確認できる。`, [r]);
    return;
  }
  // Location may have changed after the order. A failed treatment releases its
  // reservation without consuming the medicine or applying a remote effect.
  if (a.kind === "heal" && (!peer || peer.location !== r.location || (!atBase(r) && getPresentEncounterAt(s, r.location)))) {
    r.action = null;
    log(s, "system", "手当を見合わせた",
      `${r.name}は手当を見合わせた。同じ場所で手当できる状態ではなくなったため、手当用品は使わずに残した。`, [r]);
    return;
  }
  if (!a.cargo) consume(s, r, a);
  r.action = null;
  switch (a.kind) {
    case "cook":
      addResourcesAt(s, r, { food: 3 });
      r.skills.cooking = Math.min(10, r.skills.cooking + 0.12);
      r.mood = clamp(r.mood + (r.id === "mio" ? 5 : 2));
      log(
        s,
        "work",
        "温かい食事ができた",
        `${r.name}が食材2個で食事を3食作った。鍋から、やさしい湯気が立ちのぼる。`,
        [r],
      );
      break;
    case "eat": {
      r.hunger = clamp(r.hunger + 55);
      r.mood = clamp(r.mood + 8);
      const meal = finishMeal(s, r, due, revivedIds);
      const history = ensureAutonomy(s);
      for (let i = 0; i < meal.participants.length; i++) for (let j = i + 1; j < meal.participants.length; j++) {
        const first = meal.participants[i], second = meal.participants[j];
        const key = pairKey(first.id, second.id), previous = history.mealPairs[key];
        if (previous && previous.location === r.location && s.minutes - previous.time <= 5) continue;
        bond(first, second, 3, 1); bond(second, first, 3, 1);
        history.mealPairs[key] = { time: s.minutes, location: r.location, eventId: meal.event.id };
      }
      if (meal.shouldLog) log(
        s,
        meal.participants.length > 1 ? "social" : "life",
        meal.participants.length > 1 ? atBase(r) ? "同じ食卓で" : "旅先での食事" : "ひとりの食事",
        meal.participants.length > 1
          ? atBase(r) ? `${meal.participants.map((p) => p.name).join("と")}は同じ場所で食事をとった。「こういう時間があると、ほっとするね」` : meal.event.text
          : atBase(r) ? `${r.name}は温かい食事をゆっくり味わった。空腹が満たされる。` : `${r.name}は持ってきた食事をとった。空腹が満たされる。`,
        meal.participants,
        true,
      );
      break;
    }
    case "rest":
      r.energy = clamp(r.energy + 28 + getLocalProjectEffects(s, r.location).restEnergyBonus);
      r.hp = clamp(r.hp + 2 + getLocalProjectEffects(s, r.location).restHpBonus);
      r.mood = clamp(r.mood + 6);
      if (a.autonomyReason?.code === "quiet") recordExperience(s, "quiet", [r.id], { text: `${r.name}が静かな場所で、自分の時間を過ごした。` });
      log(
        s,
        "life",
        "ひと息ついて",
        `${r.name}は${r.location === "lodge" ? "舟宿の板間で" : r.id === "ren" ? "窓から少し離れた静かな席で" : "風の通る窓辺で"}休んだ。体力と気力が戻ってきた。`,
        [r],
      );
      break;
    case "sleep": {
      const site = getSleepSite(a.origin ?? r.location);
      r.mood = clamp(r.mood + Math.min(6, a.progress / 80));
      if (site?.healsWounds && a.progress >= 240)
        for (const k of ["arm", "leg", "body"] as const)
          r.wounds[k] = Math.max(0, r.wounds[k] - 1);
      log(
        s,
        "life",
        s.minutes % 1440 === 480 ? "新しい朝" : "眠りから覚めた",
        site?.kind === "travel"
          ? site.location === "lodge"
            ? `${r.name}は舟宿の寝床で目を覚ました。物置と鍋がある。今日もここで過ごすか、川下へ出るかを選べる。`
            : `${r.name}は${site.name}で眠りから覚めた。食事と手当用品は携行品から使う。体調と帰り道を確かめよう。`
          : s.minutes % 1440 === 480
          ? `${r.name}は眠りから覚めた。眠る前の出来事も、この朝へ続いている。体調を確かめよう。`
          : `${r.name}は眠りから覚めた。体調を確かめて、次の過ごし方を選べる。`,
        [r],
      );
      break;
    }
    case "socialize":
      finishConversation(s, r, a, due, revivedIds, topicAttention);
      break;
    case "hobby": {
      s.flags.hobbyFinished = true;
      const craft = finishCraft(s, r, a.id, "bird", a.subjectEventId);
      r.mood = clamp(r.mood + 20);
      r.skills.craft = Math.min(10, r.skills.craft + 0.15);
      log(
        s,
        "life",
        "小さな木彫り",
        a.subjectEventId === undefined
          ? `${r.name}が掌にのる小鳥を彫った。少し不揃いだけれど、ここで暮らした時間の形だ。今は手元にある。飾る場所を選ぼう。`
          : `${r.name}が${getCraftDisplayTitle(s, craft)}を仕上げた。今は手元にあり、飾る場所を選べる。`,
        [r],
        true,
      );
      break;
    }
    case "project": {
      const recipe = getProjectRecipe(a.target);
      if (!recipe) break;
      r.skills.craft = Math.min(10, r.skills.craft + 0.2);
      r.mood = clamp(r.mood + 12);
      if (recipe.id === "wood-flower") {
        s.flags.hobbyFinished = true;
        const craft = finishCraft(s, r, a.id, "flower", a.subjectEventId);
        log(s, "life", "木彫りの花", a.subjectEventId === undefined
          ? `${r.name}が回収材1個から、一輪の花を彫った。今は手元にあり、窓辺へ飾る場所を選べる。`
          : `${r.name}が回収材1個から、${getCraftDisplayTitle(s, craft)}を仕上げた。今は手元にあり、窓辺へ飾る場所を選べる。`, [r], true);
      } else {
        const life = ensureLife(s);
        life.upgrades ??= [];
        life.upgrades.push({ id: a.id, recipeId: recipe.id, creatorId: r.id, location: r.location, completedAt: s.minutes });
        recordExperience(s, "project", [r.id], { projectId: a.id,
          text: `${r.name}が、この場所で「${recipe.title}」を仕上げた。暮らしの中で使えるようになった。` });
        const name = recipe.id === "kitchen-tools" ? "料理道具" : recipe.id === "rest-corner" ? "静かな休憩場所" : "手仕事台";
        log(s, "work", recipe.title, `${r.name}が回収材3個で、この場所の${name}を整えた。${recipe.effect}`, [r], true);
      }
      break;
    }
    case "decorate":
      s.flags.decorated = true;
      finishShelf(s, r);
      r.mood = clamp(r.mood + 15);
      log(
        s,
        "life",
        "自分の居場所",
        a.restoringShelf
          ? `${r.name}は以前からある棚を、この場所の窓辺へ整えた。新たな材料は使わず、置き場所を決め直した。`
          : `${r.name}は回収材2個で窓辺に小さな棚を作った。好きなものを置ける場所が、この家に一つ増えた。`,
        [r],
        true,
      );
      break;
    case "place-craft": {
      const craft = finishPlacement(s, r, Number(a.target));
      log(
        s,
        "life",
        craft ? "窓辺に自分の作品を" : "飾るのはまた今度",
        craft
        ? `${r.name}が、自分で作った${getCraftDisplayTitle(s, craft)}を棚へそっと置いた。この場所に、暮らした時間の形が残った。`
          : `${r.name}は作品と棚の様子を確かめた。飾る条件が変わったので、置かずに手元へ残した。`,
        [r],
        !!craft,
      );
      break;
    }
    case "gather":
      if (r.location === "garden") {
        addResourcesAt(s, r, { ingredients: 3 });
        recordExperience(s, "supply", [r.id], {
          text: `${r.name}が裏庭で、明日の食事に使える食材を集めた。`,
        });
        log(
          s,
          "work",
          "裏庭の収穫",
          `${r.name}は食べられる葉と根を集めた。食材を3個持ち帰った。`,
          [r],
        );
      } else if (isHarvestLocation(r.location)) {
        const site = HARVEST_SITES[r.location];
        const collectors = [r, ...s.residents.filter((other) => other.id !== r.id && other.hp > 0
          && other.location === r.location && other.action?.kind === "gather" && due.has(other.action.id))]
          .sort((first, second) => first.id.localeCompare(second.id));
        for (const person of collectors) person.action = null;
        const recipient = collectors[0];
        const result = regionHarvest(s, recipient.id);
        if (result.received) {
          addResourcesAt(s, recipient, result.received);
          const names = collectors.map((person) => person.name).join("と");
          const text = `${names}が${site.name}で食材${site.ingredients}個と資材${site.scrap}個を集め、${recipient.name}の荷物に収めた。今日の収穫はここまで。`;
          recordExperience(s, "supply", collectors.map((person) => person.id), { text });
          log(s, "explore", `${site.name}の収穫`, text, collectors);
        } else log(s, "system", "今日の収穫は済んでいる", result.error ?? "また明日、川沿いの様子を見られます。", collectors);
      } else if (finiteCache(r.location)) finishFiniteGather(s, r, due);
      break;
    case "move":
      if (!a.automatic && atBase(r)) recordManualStay(s, r, "arrival");
      if (atBase(r) && a.origin && LOCATIONS[a.origin].kind === "wild")
        finishReturn(s, r);
      log(
        s,
        "explore",
        "移動を終えて",
        `${r.name}が${LOCATIONS[r.location].name}に着いた。${atBase(r) && a.origin && LOCATIONS[a.origin].kind === "wild" ? "見慣れた家の灯りに、肩の力が抜ける。" : ""}`,
        [r],
      );
      if (a.cargo) {
        const error = depositCargo(s, r, a);
        if (error) stopCargo(s, r, a, `${error} `);
      }
      if (a.automatic && a.autonomyNext && a.autonomyReason) continueAutonomousWork(s, r, a);
      break;
    case "defend":
      log(
        s,
        "combat",
        "援護を終えた",
        `${r.name}は周囲を確かめ、構えを解いた。`,
        [r], false, undefined, getEncounter(s, actionEncounterId(a)),
      );
      break;
    case "rescue":
      if (peer && r.hp > 0) {
        r.location = "home";
        peer.location = "home";
        if (peer.action?.cargo) stopCargo(s, peer, peer.action, "救助による帰宅で運搬を続けられない。 ");
        if (peer.action?.kind !== "repair-route" && peer.action?.kind !== "approach-ridge") peer.action = null;
        bond(r, peer, 2, 5);
        if (peer.hp > 0) bond(peer, r, 4, 10);
        recordExperience(s, "rescue", [r.id], {
          subjectId: peer.id,
          text: `${r.name}が${peer.name}を運んで、拠点へ連れて帰った。`,
        });
        log(
          s,
          "combat",
          "仲間を連れて帰った",
          `${r.name}が${peer.name}を救助し、拠点へ運び込んだ。傷は残る。まずは手当と休息を。`,
          [r, peer],
          true,
        );
        s.pauseReason = `${peer.name}を救助して帰還しました。手当と仕事の交代を確認してください。`;
      }
      break;
    case "heal":
      if (peer && peer.location === r.location) {
        peer.hp = clamp(peer.hp + 45);
        for (const k of ["arm", "leg", "body"] as const)
          peer.wounds[k] = Math.max(0, peer.wounds[k] - 2);
        peer.mood = clamp(peer.mood + 8);
        if (peer.hp > 0 && peer.action?.kind !== "sleep") bond(peer, r, 3, 7);
        recordExperience(s, "heal", [r.id], {
          subjectId: peer.id,
          text: `${r.name}が${peer.name === r.name ? "自分" : peer.name}の傷を手当した。`,
        });
        log(
          s,
          "social",
          "傷の手当",
          `${r.name}が${peer.name === r.name ? "自分" : peer.name}の傷を手当した。包帯を巻き直し、少しずつ普段の生活へ戻っていく。`,
          [r, peer],
          true,
        );
      }
      break;
    case "help":
      if (a.targetActionId !== undefined && peer?.action?.id === a.targetActionId
        && peer.hp > 0 && peer.location === r.location && HELPABLE_ACTIONS.includes(peer.action.kind)) {
        peer.action.progress = Math.min(
          peer.action.duration - 1,
          peer.action.progress + 12,
        );
        bond(r, peer, 2, 4);
        bond(peer, r, 3, 3);
        recordExperience(s, "help", [r.id], {
          subjectId: peer.id,
          text: `${r.name}が${peer.name}の進行中の仕事を手伝った。`,
        });
        log(
          s,
          "social",
          "二人で進める仕事",
          `${r.name}は${peer.name}の仕事を手伝った。「助かるよ」手を動かしながら、少しだけ笑い合った。`,
          [r, peer],
          true,
        );
      } else {
        log(s, "system", "手伝いは一区切り",
          a.targetActionId === undefined
            ? `${r.name}は手伝う作業を確認した。以前の記録では作業を特定できないため、必要なら今の仕事へ指示し直せる。`
            : `${r.name}は手を止めた。手伝う予定の仕事は今ここで進んでいない。担当と仕事を確かめて、必要なら頼み直そう。`, [r]);
      }
      break;
    case "attack":
      break;
  }
}
function startAutonomousDecision(s: GameState, r: Resident, decision: AutonomyDecision) {
  const action = makeAction(s, r, decision.kind, decision.target, true);
  if (typeof action === "string") return;
  action.autonomyReason = decision.reason;
  if (decision.nextKind) action.autonomyNext = decision.nextKind;
  r.action = action;
  recordAutonomyStart(s, r, action, decision);
}
function continueAutonomousWork(s: GameState, r: Resident, old: Action) {
  const free = accessibleResources(s, r.id);
  const kind = old.autonomyNext!;
  if (kind === "cook" && !["balanced", "cook"].includes(r.policy)) return;
  if (kind === "gather" && !["balanced", "gather"].includes(r.policy)) return;
  const other = s.residents.some((p) => p.id !== r.id && p.hp > 0
    && ((p.action?.kind === kind && (kind !== "cook" || workSite(p.action.origin) === workSite(r.location)))
      || (kind === "cook" && p.suspended?.kind === "cook" && workSite(p.suspended.origin) === workSite(r.location))
      || (p.action?.kind === "move" && p.action.autonomyNext === kind)));
  const needed = kind === "cook" ? needsFoodProduction(s, free) && !other
    : kind === "gather" ? free.ingredients < (r.policy === "gather" ? 12 : 4) && !other
    : r.energy < 28 || r.hp < 45 || (r.policy === "rest" && (r.energy < 85 || r.hp < 90));
  if (!needed || r.suspended || r.hp <= 0) return;
  const target = getFoodProductionTarget(s);
  const text = kind === "cook"
    ? target === DEFAULT_FOOD_PRODUCTION_TARGET
      ? "食事が少ないため、料理道具のある場所で用意する"
      : `補充目安${target}食に届かないため、料理する`
    : old.autonomyReason!.text;
  startAutonomousDecision(s, r, { kind, reason: { ...old.autonomyReason!, text, decidedAt: s.minutes } });
}
function autoAction(s: GameState, r: Resident) {
  const decision = getAutonomyDecision(s, r.id);
  if (decision) startAutonomousDecision(s, r, decision);
}
/** Residents currently exposed to the guard, regardless of the selected UI scene. */
export type CombatGroup = { encounter: EncounterView; residents: Resident[] };
export function getCombatGroups(state: GameState): CombatGroup[] {
  if (state.ended) return [];
  return getEncounters(state).filter(encounter => encounter.present).map(encounter => ({ encounter,
    residents: state.residents.filter(r => r.location === encounter.location && r.hp > 0
      && !(r.action?.kind === "move" && (r.action.segmentProgress || 0) > 1)),
  })).filter(group => group.residents.length > 0);
}
export function getCombatants(state: GameState): Resident[] {
  return getCombatGroups(state).flatMap(group => group.residents);
}
function isAutomaticBattle(action: Action | null): boolean {
  return !!action?.automatic && ["attack", "defend"].includes(action.kind);
}
/** Global OFF clears all AI; one resolution clears only its own target. */
function clearAutomaticBattleActions(state: GameState, preservedIds: ReadonlySet<string> = new Set(), encounterId?: EncounterId) {
  for (const resident of state.residents) {
    if (preservedIds.has(resident.id)) continue;
    if (isAutomaticBattle(resident.action) && (!encounterId || actionEncounterId(resident.action!) === encounterId)) resident.action = null;
    if (isAutomaticBattle(resident.suspended) && (!encounterId || actionEncounterId(resident.suspended!) === encounterId)) resident.suspended = null;
  }
}
function automaticBattle(state: GameState, revivedIds: ReadonlySet<string>) {
  if (!state.autoCombat || state.ended) { clearAutomaticBattleActions(state, revivedIds); return; }
  const patients = new Set(state.residents.filter(carrier => carrier.hp > 0).flatMap(carrier =>
    [carrier.action, carrier.suspended].filter(action => action?.kind === "rescue"
      && validRescueTarget(carrier, state.residents.find(patient => patient.id === action.target)))
      .map(action => action!.target)));
  const groups = getCombatGroups(state).map(group => ({ ...group, residents: group.residents.filter(resident =>
    !revivedIds.has(resident.id) && !patients.has(resident.id) && resident.action?.kind !== "move") }));
  for (const resident of state.residents) {
    if (revivedIds.has(resident.id)) continue;
    if (isAutomaticBattle(resident.action) && !groups.some(group => group.encounter.id === actionEncounterId(resident.action!)
      && group.residents.some(person => person.id === resident.id))) resident.action = null;
    if (isAutomaticBattle(resident.suspended)) resident.suspended = null;
  }
  for (const group of groups) {
    const exposed = group.residents;
    const available = exposed.filter(resident => (!resident.action || isAutomaticBattle(resident.action))
      && !(resident.suspended && !resident.suspended.automatic && ["attack", "defend"].includes(resident.suspended.kind)));
    const manualDefender = exposed.some(resident => resident.action?.kind === "defend" && !resident.action.automatic
      && actionEncounterId(resident.action) === group.encounter.id);
    const hasAnotherAttacker = available.length > 1 || exposed.some(resident => resident.action?.kind === "attack"
      && !resident.action.automatic && actionEncounterId(resident.action) === group.encounter.id);
    const defender = hasAnotherAttacker && !manualDefender
      ? (available.find(resident => resident.action?.kind === "defend") ?? [...available].sort((a, b) => {
        const effectiveHp = (resident: Resident) => resident.hp / (resident.armor ? 0.65 : 1);
        return effectiveHp(b) - effectiveHp(a) || a.id.localeCompare(b.id);
      })[0]) : undefined;
    for (const resident of available) {
      const kind = resident.id === defender?.id ? "defend" : "attack";
      if (resident.action?.kind === kind && actionEncounterId(resident.action) === group.encounter.id) continue;
      const action = makeAction(state, resident, kind, undefined, true, undefined, group.encounter.id);
      if (typeof action !== "string") resident.action = action;
    }
  }
}

function combatTick(s: GameState, revivedIds: ReadonlySet<string>, group: CombatGroup) {
  const { encounter, residents: exposed } = group;
  const enemy = encounter.id === "ruins-guard" ? s.enemy : s.secondaryEncounter!;
  if (!exposed.length) return;
  // Calculate every hit from one snapshot, then apply all damage together.
  const snapshot = clone(exposed);
  const attackers = snapshot.filter((r) => !revivedIds.has(r.id) && r.action?.kind === "attack" && actionEncounterId(r.action) === encounter.id);
  let enemyDamage = 0;
  for (const r of snapshot)
    if (!revivedIds.has(r.id) && r.action?.kind === "attack" && actionEncounterId(r.action) === encounter.id)
      enemyDamage += Math.max(
        3,
        (r.weapon === "spear" ? 9 : r.weapon === "knife" ? 5 : 4) +
          r.skills.combat * 1.4 -
          r.wounds.arm * 2 +
          Math.floor(random(s) * 5),
      );
  const defender = snapshot.find((r) => !revivedIds.has(r.id) && r.action?.kind === "defend" && actionEncounterId(r.action) === encounter.id);
  const target = defender || snapshot[Math.floor(random(s) * snapshot.length)];
  const damage = Math.max(
    2,
    Math.round(
      ((encounter.id === "ruins-guard" ? 13 : SECOND_ENCOUNTER_RULE.damageBase)
        + Math.floor(random(s) * (encounter.id === "ruins-guard" ? 7 : SECOND_ENCOUNTER_RULE.damageRange))) *
        (target.armor ? 0.65 : 1) *
        (target.action?.kind === "defend" && actionEncounterId(target.action) === encounter.id && !revivedIds.has(target.id) ? 0.4 : 1),
    ),
  );
  enemy.hp = Math.max(0, enemy.hp - enemyDamage);
  const actual = s.residents.find((r) => r.id === target.id)!;
  actual.hp = Math.max(0, actual.hp - damage);
  actual.energy = clamp(actual.energy - 0.8);
  if (actual.hp <= 55) {
    const region = (["arm", "leg", "body"] as const)[Math.floor(random(s) * 3)];
    actual.wounds[region] = Math.min(3, actual.wounds[region] + 1);
  }
  if (enemyDamage || damage)
    log(
      s,
      "combat",
      defender ? "援護が仲間を守った" : encounter.id === "ruins-guard" ? "資材置き場での交戦" : "尾根での交戦",
      `${
        attackers
          .map((r) => r.name)
          .join("・") || "一行"
      }${enemyDamage ? `が相手に${Math.round(enemyDamage)}の打撃。` : "は相手の動きをうかがう。"}${actual.name}は${damage}のダメージを受けた。${defender ? "援護によって攻撃を引き受け、被害を抑えた。" : ""}`,
      [actual, ...attackers.filter((r) => r.id !== actual.id).map((attacker) => s.residents.find((r) => r.id === attacker.id)!)],
      false, undefined, encounter,
    );
  if (actual.hp <= 0) {
    actual.wounds.body = Math.max(2, actual.wounds.body);
    // Base recovery retains both job slots. Outside, the existing rescue and
    // interrupted-work rules still apply when a combatant falls.
    if (actual.action && !atBase(actual)) {
      const interrupted = actual.action;
      if (
        !actual.suspended &&
        !actual.action.automatic &&
        actual.action.kind !== "rescue"
      )
        actual.suspended = actual.action;
      if (!["repair-route", "approach-ridge"].includes(interrupted.kind) || actual.suspended?.id === interrupted.id) actual.action = null;
      if (interrupted.cargo && actual.suspended?.id !== interrupted.id)
        stopCargo(s, actual, interrupted, "意識を失い、運搬を続けられない。 ");
    }
    log(
      s,
      "combat",
      `${actual.name}が倒れた`,
      atBase(actual)
        ? `${actual.name}は意識を失った。拠点の仲間を操作し、周囲の安全と手当を確認できる。`
        : `${actual.name}は意識を失った。近くの仲間は救助できる。拠点の住民も引き続き操作できる。`,
      [actual],
      true, undefined, encounter,
    );
    s.pauseReason = atBase(actual)
      ? `${actual.name}が拠点で倒れました。周囲の安全と手当を確認してください。`
      : `${actual.name}が倒れました。仲間を選んで救助、または退路を確保してください。`;
  }
  if (enemy.hp <= 18) {
    enemy.defeated = true;
    for (const r of s.residents)
      if (r.action && ["attack", "defend"].includes(r.action.kind) && actionEncounterId(r.action) === encounter.id)
        r.action = null;
    log(
      s,
      "combat",
      encounter.id === "ruins-guard" ? "相手が退いた" : "尾根の見張りが退いた",
      encounter.id === "ruins-guard"
        ? "流れ者は傷を押さえ、置き場から離れた。追う必要はない。物資の回収と仲間の体調を確かめよう。"
        : "尾根の見張りは傷を押さえ、尾根から離れた。追う必要はない。仲間の体調と帰路を確かめよう。",
      exposed,
      true, undefined, encounter,
    );
    s.pauseReason ||= encounter.id === "ruins-guard" ? "流れ者が退きました。物資の回収か帰還を選べます。" : "尾根の見張りが退きました。体調と帰路を確認できます。";
  }
}
export function advance(state: GameState, minutes: number, options: AdvanceOptions = {}): GameState {
  const s = clone(state);
  if (s.ended || !Number.isFinite(minutes)) return s;
  const amount = Math.max(0, Math.min(1440, Math.floor(minutes)));
  if (amount === 0) return s;
  s.trade ??= createTradeState(s.minutes);
  delete s.pauseReason;
  for (let tick = 0; tick < amount; tick++) {
    const roadCompletedBefore = s.routeWorks !== undefined;
    const revivedIds = new Set<string>();
    const contactedEncounterIds = new Set<EncounterId>();
    const trackedActions = new Set(s.residents.flatMap((r) => r.action ? [r.action.id] : []));
    const beforeNeeds = s.residents.map((r) => ({ id: r.id, hunger: r.hunger, energy: r.energy }));
    s.minutes++;
    for (const r of s.residents) {
      r.hunger = clamp(r.hunger - 0.055);
      r.energy = clamp(
        r.energy -
          (r.action && !["rest", "sleep"].includes(r.action.kind)
            ? 0.045
            : 0.012),
      );
      // A conscious person already eating a reserved meal can finish it even
      // when extremely weak. Stock or a paused meal alone offers no protection.
      const eatingReservedMeal = r.hp > 0 && r.action?.kind === "eat"
        && (r.action.reserved?.food ?? 0) >= 1;
      if (r.hunger <= 0 && !eatingReservedMeal) {
        r.hp = Math.max(0, r.hp - 0.05);
        r.mood = clamp(r.mood - 0.04);
      }
      if (r.hp <= 0 && atBase(r)) {
        r.hp = 0.5;
        revivedIds.add(r.id);
        log(
          s,
          "life",
          "意識が戻った",
          `${r.name}は${LOCATIONS[r.location].name}で意識を取り戻した。体力はまだ低い。食事や手当、休息を確認したい。`,
          [r],
        );
        s.pauseReason = `${r.name}の意識が戻りました。手当と休息を確認してください。`;
      }
      if (!revivedIds.has(r.id)) autoAction(s, r);
    }
    for (const r of s.residents) if (r.action) trackedActions.add(r.action.id);
    // A newly unsafe place ends this quiet action before progress or credit.
    for (const r of s.residents) if (r.action?.kind === "observe") {
      const problem = observationProblem(s, r, r.action);
      if (problem) stopObservation(s, r, problem);
    }
    const blockedRouteWorks = new Set<number>();
    for (const r of s.residents) if (r.action?.kind === "repair-route") {
      const problem = getRouteWorkProblem(s, r, r.action);
      if (problem) { blockedRouteWorks.add(r.action.id); holdRouteWork(s, r, r.action, problem); }
    }
    const blockedApproaches = new Set<number>();
    for (const r of s.residents) if (r.action?.kind === "approach-ridge") {
      const action = r.action, problem = ridgeApproachProblem(s, r, action);
      if (problem) { blockedApproaches.add(action.id); holdRidgeApproach(s, r, action, problem); }
    }
    const blockedSleeps = new Set<number>();
    for (const r of s.residents) if (r.action?.kind === "sleep") {
      const problem = r.action.origin === undefined && !atBase(r)
        ? "寝場所が記録されていない以前の睡眠は、拠点で再開してください。"
        : r.action.origin !== undefined && r.action.origin !== r.location
        ? "眠り始めた場所から離れています。寝場所を確かめてください。"
        : inspectSleep(s, r.id).error;
      if (problem) {
        // There are two explicit job slots. A safety check must not discard
        // either the sleep or an older material-reserving task in the held slot.
        if (r.suspended) {
          blockedSleeps.add(r.action.id);
          s.pauseReason ||= `${r.name}は安全に眠れないため、睡眠の進行を止めました。睡眠と中断中の仕事は保持しています。${problem}`;
          continue;
        }
        r.suspended = r.action;
        r.action = null;
        log(s, "system", "眠りを中断した", `${r.name}は眠るのをやめた。${problem}`, [r]);
        s.pauseReason ||= `${r.name}の睡眠を中断しました。${problem}`;
      }
    }
    // A helper cannot advance the owner's work while that owner is recovering
    // this minute. Keep both orders so the next explicit advance can continue.
    const blockedActions = new Set(s.residents.filter((r) => r.action
      && (blockedSleeps.has(r.action.id) || blockedRouteWorks.has(r.action.id) || blockedApproaches.has(r.action.id) || revivedIds.has(r.id) || (r.action.kind === "help" && revivedIds.has(r.action.target ?? ""))))
      .map((r) => r.action!.id));
    normalizeTogetherMoves(s, (from, to, r) => edgeDuration(from, to, r, s), revivedIds);
    // Freeze pair eligibility and attention before the sequential progress loop.
    // Rechecking equal progress after the first increment would strand its peer.
    const topicAttention = new Set(s.residents.filter((r) => r.action?.topic).map((r) => r.id));
    for (const r of s.residents) if (r.action?.topic
      && (getCraftConversationStatus(s, r.id)?.waiting || revivedIds.has(r.id)
        || revivedIds.has(r.action.target ?? ""))) blockedActions.add(r.action.id);
    const due = new Set(s.residents.filter((r) => r.hp > 0 && r.action && !blockedActions.has(r.action.id) && r.action.kind !== "attack"
      && r.action.progress + 1 >= r.action.duration).map((r) => r.action!.id));
    const togetherSteps = snapshotTogetherSteps(s, (from, to, r) => edgeDuration(from, to, r, s));
    // Actions finish against this minute's world. The battle uses the resulting shared locations.
    for (const r of s.residents) {
      const a = r.action;
      if (!a || r.hp <= 0 || blockedActions.has(a.id)) continue;
      // Validate the patient before a travel step can overwrite either location.
      if (a.kind === "rescue" && !validRescueTarget(r, s.residents.find((person) => person.id === a.target))) {
        r.action = null;
        log(s, "system", "救助を中断した", "対象の場所や体調が変わったため、救助を切り上げた。帰宅済みなら手当を確認できる。", [r]);
        continue;
      }
      if (!atBase(r) && ["eat", "heal"].includes(a.kind) && getPresentEncounterAt(s, r.location)) {
        r.action = null;
        log(s, "system", a.kind === "eat" ? "食事を見合わせた" : "手当を見合わせた", `${r.name}は周囲の危険を確かめて手を止めた。確保した物資は使わずに残した。`, [r]);
        s.pauseReason ||= `${r.name}の食事や手当を中断しました。周囲の安全と退路を確認してください。`;
        continue;
      }
      if (a.kind === "attack") {
        a.progress = (a.progress + 1) % a.duration;
        continue;
      }
      a.progress++;
      if (a.kind === "sleep") {
        const site = getSleepSite(a.origin ?? r.location)!;
        r.energy = clamp(r.energy + site.energyPerMinute);
        r.hp = clamp(r.hp + site.hpPerMinute);
      }
      if (a.kind === "rest") r.energy = clamp(r.energy + 0.2);
      if ((a.kind === "move" || a.kind === "rescue") && a.path) {
        a.segmentProgress = (a.segmentProgress || 0) + 1;
        if (a.segmentProgress >= (a.segmentDuration || 1)) {
          const nextPlace = a.path[a.segment || 0];
          const finalRescueLeg = a.kind === "rescue" && (a.segment || 0) + 1 === a.path.length;
          if (!finalRescueLeg) {
            r.location = nextPlace;
            if (a.kind === "rescue") {
              const carried = s.residents.find((p) => p.id === a.target);
              if (carried) carried.location = nextPlace;
            }
          }
          a.segment = (a.segment || 0) + 1;
          a.segmentProgress = 0;
          if (a.segment < a.path.length) {
            const together = togetherSteps.get(a.id);
            a.segmentDuration = together?.segmentDuration ?? edgeDuration(r.location, a.path[a.segment], r, s);
            let from = r.location;
            a.duration = together?.duration ?? a.progress + a.path.slice(a.segment).reduce((sum, next) => { const cost = edgeDuration(from, next, r, s); from = next; return sum + cost; }, 0);
          }
          const encounter = getPresentEncounterAt(s, r.location);
          if (encounter) {
            // A contact waits for orders locally, not in the other battlefield.
            const first = encounter.id === "ruins-guard";
            log(s, "explore", first ? "入口の人影" : "尾根の見張りと遭遇",
              first ? `${r.name}の前に流れ者が立った。「ここの物資には触るな」引き返す、援護を待つ、戦う。まだ選べる。`
                : `${r.name}の前に尾根の見張りが立った。引き返す、援護を待つ、戦う。まだ選べる。`,
              [r], true, undefined, encounter);
            s.pauseReason = first ? `${r.name}が流れ者と遭遇しました。戦闘・防御・撤退を選んでください。`
              : `${r.name}が尾根の見張りと遭遇しました。戦闘・防御・撤退を選んでください。`;
            if (first) s.enemy.alerted = true; else s.secondaryEncounter!.alerted = true;
            contactedEncounterIds.add(encounter.id);
          }
        }
      }
      if (a.kind === "rescue") {
        const carried = s.residents.find((x) => x.id === a.target);
        if (!validRescueTarget(r, carried)) {
          r.action = null;
          log(
            s,
            "system",
            "救助を中断した",
            "対象の場所や体調が変わったため、救助を切り上げた。帰宅済みなら手当を確認できる。",
            [r],
          );
          continue;
        }
        if (!a.path && a.progress === 3) {
          r.location = "road";
          if (carried) carried.location = "road";
        }
      }
      const travel = (a.kind === "move" || a.kind === "rescue") && a.path;
      if (travel ? (a.segment ?? 0) >= travel.length : a.progress >= a.duration) {
        if (travel) a.duration = a.progress;
        finish(s, r, a, due, revivedIds, topicAttention, contactedEncounterIds);
      }
    }
    if (!roadCompletedBefore && s.routeWorks !== undefined) refreshTravelAfterRouteWork(s);
    automaticBattle(s, revivedIds);
    for (const group of getCombatGroups(s)) if (!contactedEncounterIds.has(group.encounter.id)) combatTick(s, revivedIds, group);
    normalizeTogetherMoves(s, (from, to, r) => edgeDuration(from, to, r, s));
    // Stop once when a need crosses a decision boundary. Existing low needs
    // remain visible, but do not trap every subsequent minute in the same pause.
    for (const before of beforeNeeds) {
      const resident = s.residents.find((r) => r.id === before.id)!;
      if (resident.hp <= 0) continue;
      if (before.hunger > 20 && resident.hunger <= 20)
        s.pauseReason ||= `${resident.name}の空腹が強くなったため、時間を止めました。食事と今の仕事を確認してください。`;
      if (before.energy > 12 && resident.energy <= 12)
        s.pauseReason ||= `${resident.name}の活力が少なくなったため、時間を止めました。休息と今の仕事を確認してください。`;
    }
    const allDown = s.residents.every((r) => r.hp <= 0);
    if (allDown && !s.residents.some(atBase)) {
      s.ended = true;
      s.pauseReason =
        "全員が行動不能になりました。救助の手がないため、この試行を終了します。保存からの再開、または同じ朝から再試行できます。";
      log(s, "system", "この一日の結果", s.pauseReason, [], true);
    }
    const merchant = tickMerchant(s);
    if (merchant.arrived) {
      log(s, "system", "昼の行商", "小さな荷車が居間の入口へ着いた。行商は16時まで、食事や食材と資材・手当用品を交換してくれる。", []);
      s.pauseReason ||= "行商が立ち寄りました。16時まで、共同の居間で交換できます。";
    }
    if (merchant.departed) log(s, "system", "行商の出発", "行商は荷車を引いて出発した。次は翌日の12時に立ち寄る予定だ。", []);
    if (s.minutes % 1440 === 480) {
      for (const reflection of makeMorningReflections(s)) {
        const resident = s.residents.find(
          (r) => r.id === reflection.residentId,
        )!;
        log(s, "social", `${resident.name}の朝`, reflection.text, [resident]);
      }
      const conditionNotes = s.residents.filter(atBase).flatMap((person) =>
        Object.values(person.wounds).some((severity) => severity > 0)
          ? [`${person.name}には、まだ傷がある。`]
          : person.hp < 80 ? [`${person.name}は、まだ体力が戻りきっていない。`] : []);
      log(
        s,
        "life",
        `第${Math.floor(s.minutes / 1440) + 1}日の朝`,
        `朝の光が家に差し込む。食事${s.resources.food}食、食材${s.resources.ingredients}個。${conditionNotes.length
          ? `${conditionNotes.join("")}今日の分担を、少し軽くしてもいい。` : "今日は何に時間を使おう。"}`,
        s.residents.filter(atBase),
        true,
      );
      s.pauseReason ||=
        "朝になりました。体調とこれまでの経験を確かめて、今日の過ごし方を選べます。";
    }
    const duePlans = tickTravelPlanReminders(s);
    for (const plan of duePlans) {
      const names = plan.residentIds.map((id) => s.residents.find((person) => person.id === id)!.name).join("・");
      log(s, "system", "旅の予定の時刻", `「${plan.purpose}」（${names}）の帰還目安、第${Math.floor(plan.returnAt / 1440) + 1}日${formatTime(plan.returnAt)}になった。現在地と携行食を確かめて、帰るか滞在を続けるかを選べる。`, []);
    }
    if (duePlans.length)
      s.pauseReason ||= "旅の予定の帰還目安になりました。現在地・携行食・帰り道を確認し、続けるか予定を変更できます。";
    if (s.pauseReason) break;
    if (options.stopAtActionEnd) {
      const remainingActions = new Set(s.residents.flatMap((r) =>
        [r.action, r.suspended].flatMap((a) => a ? [a.id] : [])));
      if ([...trackedActions].some((id) => !remainingActions.has(id))) break;
    }
  }
  return s;
}
export function serialize(state: GameState): string {
  return JSON.stringify(state, null, 2);
}
export function deserialize(raw: string): GameState {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(
      "保存ファイルがJSON形式ではありません。現在のゲームは変更していません。",
    );
  }
  const invalid = () => {
    throw new Error(
      "保存データの内容が不正、または必要な情報が不足しています。現在のゲームは変更していません。",
    );
  };
  const record = (x: unknown): x is Record<string, unknown> =>
    !!x && typeof x === "object" && !Array.isArray(x);
  const number = (
    x: unknown,
    min = 0,
    max = Number.MAX_SAFE_INTEGER,
  ): x is number =>
    typeof x === "number" && Number.isFinite(x) && x >= min && x <= max;
  if (!record(value)) return invalid();
  if (value.version !== 1 && value.version !== 2 && value.version !== 3 && value.version !== 4 && value.version !== 5)
    throw new Error(
      "この保存形式のバージョンには対応していません（対応版: 1・2・3・4・5）。",
    );
  const s = value as unknown as GameState;
  if (
    !number(s.minutes) ||
    !Number.isInteger(s.minutes) ||
    !number(s.seed, 0, 4294967295) ||
    !number(s.nextId, 1) ||
    typeof s.ended !== "boolean" ||
    (s.autoCombat !== undefined && typeof s.autoCombat !== "boolean") ||
    (s.pauseReason !== undefined && typeof s.pauseReason !== "string")
  )
    return invalid();
  if (
    !record(s.resources) ||
    RESOURCE_KEYS.some((k) => !number(s.resources[k]))
  )
    return invalid();
  if (
    !record(s.flags) ||
    ["decorated", "hobbyFinished", "suppliesRecovered"].some(
      (k) => typeof s.flags[k as keyof typeof s.flags] !== "boolean",
    ) ||
    (s.flags.safeSuppliesRecovered !== undefined &&
      typeof s.flags.safeSuppliesRecovered !== "boolean")
  )
    return invalid();
  if (
    !record(s.enemy) ||
    !number(s.enemy.hp, 0, 100) ||
    !isLocation(s.enemy.location) ||
    typeof s.enemy.defeated !== "boolean" ||
    (s.enemy.alerted !== undefined && typeof s.enemy.alerted !== "boolean")
  )
    return invalid();
  if (
    !Array.isArray(s.residents) ||
    s.residents.some((r) => !record(r) || typeof r.id !== "string") ||
    new Set(s.residents.map((r) => r.id)).size !== s.residents.length
  )
    return invalid();
  const ids = new Set(s.residents.map((r) => r.id));
  const actionIds = new Set<number>();
  function validAction(a: Action | null, owner: Resident): boolean {
    if (a === null) return true;
    if (
      !record(a) ||
      !number(a.id, 1) ||
      actionIds.has(a.id) ||
      !ACTION_KINDS.includes(a.kind) ||
      typeof a.label !== "string" ||
      !number(a.duration, 1, 100000) ||
      !number(a.progress, 0, a.duration) ||
      (a.target !== undefined && typeof a.target !== "string") ||
      (a.automatic !== undefined && typeof a.automatic !== "boolean") ||
      (a.restoringShelf !== undefined &&
        (typeof a.restoringShelf !== "boolean" || a.kind !== "decorate")) ||
      (a.restoringShelf === true &&
        (!s.flags.decorated || s.life?.shelf !== undefined)) ||
      (a.targetActionId !== undefined && (a.kind !== "help"
        || !Number.isSafeInteger(a.targetActionId) || a.targetActionId < 1
        || a.targetActionId >= s.nextId || a.targetActionId === a.id))
    )
      return false;
    actionIds.add(a.id);
    if (a.encounterId !== undefined && !validSecondCombatAction(s, a)) return false;
    if (a.encounterId === "ridge-watch" && a === owner.action
      && (owner.location !== SECOND_ENCOUNTER_RULE.location || !getEncounter(s, "ridge-watch")?.present)) return false;
    if (a.kind === "approach-ridge" && !validRidgeApproachAction(a)) return false;
    if (a.reservationSource !== undefined && (!a.reserved || !["base", "pack"].includes(a.reservationSource))) return false;
    if (a.materialTransfers !== undefined && (a.reservationSource !== "pack" || !Array.isArray(a.materialTransfers)
      || a.materialTransfers.some((entry) => !record(entry) || !(entry.from === "base" || ids.has(entry.from))
        || !RESOURCE_KEYS.includes(entry.resource) || !number(entry.amount, Number.MIN_VALUE)))) return false;
    if (a.path !== undefined && !["move", "rescue"].includes(a.kind)) return false;
    if (a.kind === "rescue" && a.path !== undefined && (!Array.isArray(a.path) || !a.path.length || a.path.some((id) => !isLocation(id))
      || a.path[a.path.length - 1] !== "home" || !Number.isInteger(a.segment) || !number(a.segment, 0, a.path.length - 1)
      || !number(a.segmentProgress, 0) || !number(a.segmentDuration, 1))) return false;
    if (
      a.reserved &&
      (!record(a.reserved) ||
        Object.keys(a.reserved).some(
          (k) => !RESOURCE_KEYS.includes(k as (typeof RESOURCE_KEYS)[number]),
        ) ||
        RESOURCE_KEYS.some(
          (k) => a.reserved?.[k] !== undefined && !number(a.reserved[k]),
        ))
    )
      return false;
    if (a.cargo !== undefined && (!validMoveCargo(a.cargo) || a.kind !== "move" || a.target !== "home"
      || a.automatic === true || !isLocation(a.origin) || LOCATIONS[a.origin].kind !== "wild"
      || !exactCargoReservation(a) || !Number.isSafeInteger(a.progress) || !Number.isSafeInteger(a.duration)
      || a.autonomyReason !== undefined || a.autonomyNext !== undefined || a.subjectEventId !== undefined
      || a.craftingToolsId !== undefined || a.topic !== undefined || a.targetActionId !== undefined
      || a.restoringShelf !== undefined)) return false;
    const expectedReservation: Partial<Resources> =
      a.cargo ? { [a.cargo.resource]: a.cargo.amount }
        : a.kind === "repair-route" ? RIVER_PATH_RULE.cost
        : a.kind === "project"
        ? getProjectRecipe(a.target)?.cost ?? {}
        : a.kind === "cook"
        ? { ingredients: 2 }
        : a.kind === "eat"
          ? { food: 1 }
          : a.kind === "decorate" && !a.restoringShelf
            ? { scrap: 2 }
            : a.kind === "heal"
              ? { medicine: 1 }
              : {};
    if (
      RESOURCE_KEYS.some(
        (k) => (a.reserved?.[k] || 0) !== (expectedReservation[k] || 0),
      )
    )
      return false;
    if (a.kind === "move") {
      if (
        !Array.isArray(a.path) ||
        !a.path.length ||
        a.path.some((p) => !isLocation(p)) ||
        !number(a.segment, 0, a.path.length - 1) ||
        !Number.isInteger(a.segment) ||
        !number(a.segmentProgress, 0) ||
        !number(a.segmentDuration, 1) ||
        a.segmentProgress >= a.segmentDuration ||
        !isLocation(a.target) ||
        a.path[a.path.length - 1] !== a.target
      )
        return false;
    }
    if (a.origin !== undefined && !isLocation(a.origin)) return false;
    if (a.cargo) {
      let from = a.origin!;
      for (const next of a.path!) {
        if (!LOCATIONS[from].connections.includes(next)) return false;
        from = next;
      }
      if (!Number.isSafeInteger(a.segmentProgress) || !Number.isSafeInteger(a.segmentDuration)) return false;
      if (a === owner.action) {
        const current = a.segment ? a.path![a.segment - 1] : a.origin;
        if (owner.location !== current || s.residents.some(carrier => carrier.id !== owner.id && carrier.hp > 0
          && validRescueTarget(carrier, owner)
          && [carrier.action, carrier.suspended].some(job => job?.kind === "rescue" && job.target === owner.id))) return false;
      }
    }
    if (a.craftingToolsId !== undefined) {
      if (!Number.isSafeInteger(a.craftingToolsId) || a.craftingToolsId < 1 || a.craftingToolsId >= s.nextId
        || !["hobby", "project"].includes(a.kind) || !a.origin || (LOCATIONS[a.origin].kind !== "base" && a.origin !== "lodge")
        || !record(s.life) || !Array.isArray(s.life.upgrades) || !Array.isArray(s.life.events)) return false;
      const tools = s.life.upgrades.find(upgrade => record(upgrade) && upgrade.id === a.craftingToolsId
        && upgrade.recipeId === "crafting-tools" && upgrade.location === a.origin);
      if (!tools || !s.life.events.some(event => record(event) && event.kind === "project"
        && event.projectId === tools.id && Number.isSafeInteger(event.id) && event.id > tools.id && event.id < a.id
        && event.time === tools.completedAt && event.location === tools.location
        && Array.isArray(event.actors) && event.actors.includes(tools.creatorId))) return false;
    }
    if (a.kind === "sleep") {
      if (a.origin !== undefined && !getSleepSite(a.origin)) return false;
      if (a === owner.action && (a.origin !== undefined
        ? owner.location !== a.origin : !atBase(owner))) return false;
    }
    if (a.topic !== undefined && (!record(a.topic)
      || Object.keys(a.topic).length !== 3
      || Object.keys(a.topic).some((key) => !["kind", "craftId", "peerActionId"].includes(key))
      || a.topic.kind !== "craft" || !Number.isSafeInteger(a.topic.craftId) || a.topic.craftId < 1
      || !Number.isSafeInteger(a.topic.peerActionId) || a.topic.peerActionId < 1
      || a.topic.peerActionId >= s.nextId || a.topic.peerActionId === a.id
      || a.kind !== "socialize" || a.automatic === true || a.duration !== 20
      || !Number.isInteger(a.progress) || a.progress >= a.duration
      || !a.origin || LOCATIONS[a.origin].kind !== "base"
      || a.reserved !== undefined || a.subjectEventId !== undefined || a.targetActionId !== undefined
      || a.path !== undefined || a.segment !== undefined || a.segmentProgress !== undefined
      || a.segmentDuration !== undefined || a.restoringShelf !== undefined
      || a.autonomyReason !== undefined || a.autonomyNext !== undefined)) return false;
    if (a.subjectEventId !== undefined && (a.automatic === true
      || !((a.kind === "hobby" && a.target === undefined)
        || (a.kind === "project" && a.target === "wood-flower"))
      || !a.origin || (LOCATIONS[a.origin].kind !== "base" && a.origin !== "lodge")
      || !validCraftSubjectReference(s, owner.id, a.subjectEventId, a.id, s.minutes))) return false;
    if (a.kind === "observe" && (!a.origin || !isSceneryLocation(a.origin)
      || a.duration !== 20 || !Number.isInteger(a.progress)
      || a.target !== undefined || a.reserved !== undefined || a.automatic === true
      || a.path !== undefined || a.segment !== undefined
      || a.segmentProgress !== undefined || a.segmentDuration !== undefined
      || a.autonomyReason !== undefined || a.autonomyNext !== undefined)) return false;
    if (a.kind === "project" && (!getProjectRecipe(a.target) || !a.origin
      || (LOCATIONS[a.origin].kind !== "base" && !(a.origin === "lodge" && lodgeWork("project", a.target))))) return false;
    if (a.origin === "lodge" && lodgeWork(a.kind, a.target)) {
      if (a === owner.action && owner.location !== "lodge") return false;
      if (a.reserved && (a.reservationSource !== "pack" || a.materialTransfers !== undefined)) return false;
    }
    if (a.kind === "repair-route" && !validRouteWorkAction(a)) return false;
    if (a.kind === "place-craft") {
      if (
        !Array.isArray(s.life?.crafts) ||
        !s.life?.shelf ||
        !a.target ||
        a.origin !== s.life.shelf.location ||
        !s.life.crafts.some(
          (c) =>
            record(c) &&
            String(c.id) === a.target &&
            c.authorId === owner.id &&
            c.displayedAt === undefined,
        )
      )
        return false;
    }
    if (
      ["socialize", "rescue", "heal", "help"].includes(a.kind) &&
      (!a.target || !ids.has(a.target))
    )
      return false;
    return true;
  }
  for (const r of s.residents) {
    if (
      !record(r) ||
      typeof r.name !== "string" ||
      typeof r.role !== "string" ||
      typeof r.wish !== "string" ||
      !Array.isArray(r.traits) ||
      !r.traits.every((t) => typeof t === "string") ||
      !isLocation(r.location) ||
      !["hp", "hunger", "energy", "mood"].every((k) =>
        number(r[k as keyof Resident], 0, 100),
      ) ||
      !["knife", "spear", "staff"].includes(r.weapon) ||
      typeof r.armor !== "boolean" ||
      !["balanced", "cook", "gather", "rest"].includes(r.policy) ||
      (r.routine !== undefined && !validRoutine(r.routine)) ||
      (r.wishKind !== undefined && !["display", "household-meal", "safe-return", "settle"].includes(r.wishKind)) ||
      !validAction(r.action, r) ||
      !validAction(r.suspended, r) ||
      !record(r.skills) ||
      !["cooking", "combat", "craft"].every((k) =>
        number(r.skills[k as keyof typeof r.skills], 0, 10),
      ) ||
      !record(r.wounds) ||
      !["arm", "leg", "body"].every((k) =>
        number(r.wounds[k as keyof typeof r.wounds], 0, 3),
      ) ||
      !Array.isArray(r.memories) ||
      !r.memories.every((m) => typeof m === "string") ||
      !record(r.relations)
    )
      return invalid();
    // The screen renders every relation entry, so only other residents may be keys.
    if (Object.keys(r.relations).some((id) => id === r.id || !ids.has(id)))
      return invalid();
    for (const id of ids)
      if (
        id !== r.id &&
        (!record(r.relations[id]) ||
          !number(r.relations[id].closeness, 0, 100) ||
          !number(r.relations[id].trust, 0, 100))
      )
        return invalid();
  }
  const kitchens = new Set<string>();
  for (const resident of s.residents) for (const job of [resident.action, resident.suspended]) {
    if (job?.kind !== "cook") continue;
    const site = workSite(job.origin);
    if (kitchens.has(site)) return invalid();
    kitchens.add(site);
  }
  if (RESOURCE_KEYS.some((k) => availableResources(s)[k] < 0) || !validInventory(s, Object.keys(LOCATIONS))
    || !validCurrencyState(s, Object.keys(LOCATIONS)) || !validRegion(s) || !validRoster(s)) return invalid();
  if (
    !Array.isArray(s.logs) ||
    !s.logs.every(
      (l) =>
        record(l) &&
        number(l.id, 1) &&
        number(l.time, 0, s.minutes) &&
        ["life", "work", "social", "explore", "combat", "system"].includes(
          l.type,
        ) &&
        typeof l.title === "string" &&
        typeof l.text === "string" &&
        Array.isArray(l.actors) &&
        Array.isArray(l.witnesses) &&
        [...l.actors, ...l.witnesses].every((id) => ids.has(id) || REGION_NPCS.some((npc) => npc.id === id)
          || (id === GUARD_AGREEMENT_RULE.counterpartId && l.guardAgreement !== undefined)),
    )
  )
    return invalid();
  if (s.nextId <= Math.max(0, ...s.logs.map((l) => l.id), ...actionIds))
    return invalid();
  if (!validLifeState(s) || !validVillageArt(s)) return invalid();
  if (!validCraftConversationActions(s)) return invalid();
  if (!validAutonomy(s)) return invalid();
  if (!validTradeState(s)) return invalid();
  if (!validTravelPlans(s)) return invalid();
  if (!validSelectionPresets(s)) return invalid();
  if (!validFoodProduction(s)) return invalid();
  if (!validRouteWorks(s)) return invalid();
  if (!validGuardAgreement(s)) return invalid();
  if (!validSecondaryEncounter(s)) return invalid();
  if (!validTogetherMoves(s, (from, to) => LOCATIONS[from].connections.includes(to))) return invalid();
  const builtOrStarted = new Set(s.life?.upgrades?.map(u => workSite(u.location) + "/" + u.recipeId));
  for (const resident of s.residents) for (const job of [resident.action, resident.suspended]) {
    if (job?.kind !== "project" || !job.target || getProjectRecipe(job.target)?.repeatable) continue;
    const key = workSite(job.origin) + "/" + job.target;
    if (builtOrStarted.has(key)) return invalid();
    builtOrStarted.add(key);
  }
  if (s.version === 1) {
    ensureInventory(s);
    s.region ??= createRegionState(s);
  }
  initializeResidentProfiles(s);
  s.version = s.version === 5 ? 5 : s.secondaryEncounter ? 4 : 3;
  return clone(s);
}
