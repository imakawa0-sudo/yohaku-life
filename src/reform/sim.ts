import {
  mealSpace,
  refundMeal,
  settleMealReturns,
  stockLimit,
  validMealReturns,
} from "./mealStock";
import { finishLodgingWalk, usualHomeArrival } from "./housing/lodging";
import {
  cancelBenchActor,
  finishBenchMinute,
  prepareBenchMinute,
  settleBenchFinish,
} from "./housing/benchRecovery";
import { recordRoomStayMinute } from "./housing/roomStay";
import { tryFoodSupply } from "./housing/foodSupply";
import { presentFood, refreshFoodHandling, settleFood } from "./housing/food";
import {
  cancelFoodActor,
  finishFoodHaul,
  prepareFoodMinute,
} from "./housing/foodProgress";
import { homeColdProtection } from "./housing/coldProtection";
import {
  cancelConstructionActor,
  finishConstructionMinute,
  prepareConstructionMinute,
  settleConstructionReturn,
} from "./housing/constructionProgress";
import {
  cancelGatheringMember,
  finishGatheringMinute,
  heldGatheringOrders,
} from "./housing/gatheringProgress";
import type { Persona, Skill } from "./peopleModel";
import { isPersona, skillKeys, skillNames } from "./peopleModel";
import {
  cookingStation,
  furnishings,
  initialHouse,
  isBasicWoodwork,
  isHouse,
  service,
} from "./house";
import type { House, Need } from "./house";
import { recoveryUseMinutes } from "./housing/types";
import type {
  GatheringKind,
  HousingTaskBinding,
  HousingRuntime,
  HousingUsePreview,
} from "./housing/types";
import { completeRoomConstruction, isHousingRuntime } from "./housing/runtime";
import {
  advanceHousingMinute,
  cancelHousingTask,
  housingInTransit,
  housingTaskBoundary,
  housingTogether,
  planHousing,
  safeExitReason,
  type HousingProposal,
} from "./housing/bridge";
export {
  enableHousing,
  setHousingPassage,
  setHousingRoomAccess,
} from "./housing/bridge";
export { nextCompletionMinutes } from "./housing/presentation";
import {
  applyProject,
  dayWorld,
  isWorld,
  places,
  projectInfo,
  travelMinutes,
} from "./world";
import type { World } from "./world";

export const needNames: Record<Need, string> = {
  hunger: "満腹",
  bladder: "膀胱",
  hygiene: "衛生",
  energy: "体力",
  social: "社交",
  fun: "楽しさ",
};
export const needKeys = Object.keys(needNames) as Need[];
export const bondNames = {
  friend: "友人",
  family: "家族",
  lover: "恋人",
  rival: "宿敵",
  neutral: "知人",
} as const;
export type Bond = keyof typeof bondNames;
type Stock = { wood: number; food: number; ingredients: number; coins: number };
type Metric = "free" | "work" | "care" | "travel" | "waiting";
type OptionGroup = "need" | "work" | "relation" | "field" | "task";
export type ActionPreview = {
  disabled?: string;
  minutes?: number;
  reserved?: Partial<Stock>;
  facility?: HousingUsePreview;
  foodBundle?: HousingProposal["foodBundle"];
};
export type FacilitySelection = { fixtureId: string; bundleId?: string };
export type WorkFacilitySelection = FacilitySelection;
export type CookingFacilitySelection = WorkFacilitySelection;
export interface ActionOption extends ActionPreview {
  kind: string;
  label: string;
  target?: string;
  group: OptionGroup;
}
export interface Memory {
  gathering?: { kind: GatheringKind; peerId: string };
  label: string;
  value: number;
  until: number;
}
export interface Relationship {
  kind: Bond;
  trust: number;
  affection: number;
}
export interface Task {
  spatial?: HousingTaskBinding;
  kind: string;
  label: string;
  target?: string;
  remaining: number;
  total: number;
  from: string;
  room?: string;
  station?: string;
  partner?: string;
  follower?: boolean;
  mode: "direct" | "auto";
  metric: Metric;
  reserved: Partial<Stock>;
}
export interface Actor {
  person: Persona;
  location: string;
  room: string;
  needs: Record<Need, number>;
  reason: string;
  task: Task | null;
  mood: number;
  injury: number;
  memories: Memory[];
  relations: Record<string, Relationship>;
  xp: Record<Skill, number>;
  experience: number;
  level: number;
  specialty: Skill | null;
  priority: Skill | null;
  cargo: Stock;
  metrics: Record<Metric, number>;
  strainUntil: number;
  nextShift: number;
  practicedOn: number;
  danger: boolean;
}
export interface Game extends Stock {
  pendingMealReturns?: number;
  housing?: HousingRuntime;
  version: 1;
  actors: Actor[];
  world: World;
  house: House;
  home: string;
  time: number;
  log: string[];
  foodTarget: { low: number; high: number };
  stocking: boolean;
  insulated: boolean;
  rng: number;
}

const zeros = (): Stock => ({ wood: 0, food: 0, ingredients: 0, coins: 0 });
const stocks = ["wood", "food", "ingredients", "coins"] as const;
const clamp = (value: number, min = 0, max = 100) =>
  Math.max(min, Math.min(max, value));
const round1 = (n: number) => Math.round(n * 10) / 10;
const find = (g: Game, id: string) => g.actors.find((a) => a.person.id === id);
const account = (g: Game, a: Actor): Stock =>
  a.location === g.home ? g : a.cargo;
const day = (g: Game) => Math.floor(g.time / 1440) + 1;
export function skillThreshold(level: number) {
  return 35 + level * 15;
}
export function personThreshold(level: number) {
  return (65 * level * (level + 1)) / 2;
}

const difficulty = { easy: 1, hard: 4, master: 7 };
const jobNames: Record<Skill, Record<keyof typeof difficulty, string>> = {
  wood: {
    easy: "枝を削って木材を整える",
    hard: "丈夫な建具を組む",
    master: "断熱雨戸を製作する",
  },
  cook: {
    easy: "野菜を煮て食事を作る",
    hard: "保存のきく料理を仕込む",
    master: "旅用の滋養食を仕込む",
  },
  trade: {
    easy: "市場で材を売る",
    hard: "材のまとまった商談をする",
    master: "木材の継続契約を結ぶ",
  },
  care: {
    easy: "手当ての手順を練習する",
    hard: "薬草の調合を練習する",
    master: "手当てを仲間に教える",
  },
};

function notice(g: Game, text: string) {
  const clock = g.time % 1440;
  const stamp =
    String(Math.floor(clock / 60)).padStart(2, "0") +
    "時" +
    String(clock % 60).padStart(2, "0") +
    "分";
  g.log.unshift(day(g) + "日目 " + stamp + "　" + text);
  if (g.log.length > 100) g.log.length = 100;
}
function memory(
  g: Game,
  a: Actor,
  label: string,
  value: number,
  duration: number,
) {
  const old = a.memories.find((m) => m.label === label);
  if (old) {
    old.until = g.time + duration;
    old.value = value;
  } else a.memories.push({ label, value, until: g.time + duration });
}

function relation(kind: Bond): Relationship {
  const trust = { family: 42, friend: 28, lover: 54, neutral: 0, rival: -42 }[
    kind
  ];
  return {
    kind,
    trust,
    affection:
      kind === "lover"
        ? 70
        : kind === "family"
          ? 35
          : kind === "rival"
            ? -25
            : 8,
  };
}
export function createGame(
  people: Persona[],
  world: World,
  start: string,
  house?: House,
): Game {
  if (
    !people.length ||
    people.length > 3 ||
    new Set(people.map((p) => p.id)).size !== people.length
  )
    throw new Error("一〜三人の異なる住人を選んでください。");
  if (!places(world).some((p) => p.id === start))
    throw new Error("開始地点が見つかりません。");
  const actors: Actor[] = people.map((p) => ({
    person: structuredClone(p),
    location: start,
    room: "living",
    needs: {
      hunger: 73,
      bladder: 74,
      hygiene: 68,
      energy: 88,
      social: 61,
      fun: 57,
    },
    reason: "朝を迎え、最初の予定を待っています。",
    task: null,
    mood: 60,
    injury: 0,
    memories: [],
    relations: {},
    xp: { wood: 0, cook: 0, trade: 0, care: 0 },
    experience: 0,
    level: 1,
    specialty: null,
    priority: null,
    cargo: zeros(),
    metrics: { free: 0, work: 0, care: 0, travel: 0, waiting: 0 },
    strainUntil: 0,
    nextShift: 0,
    practicedOn: 0,
    danger: false,
  }));
  for (const a of actors)
    for (const b of actors)
      if (a !== b) a.relations[b.person.id] = relation("neutral");
  const g: Game = {
    version: 1,
    actors,
    world: structuredClone(world),
    house: structuredClone(house ?? initialHouse()),
    home: start,
    time: 480,
    wood: 14 + people.filter((p) => p.background === "artisan").length * 4,
    coins: 8 + people.filter((p) => p.background === "trader").length * 4,
    food: people.length * 3 + 1,
    ingredients:
      people.length * 2 +
      2 +
      people.filter((p) => p.background === "local").length * 3,
    log: [],
    foodTarget: { low: people.length * 2, high: people.length * 4 + 1 },
    stocking: false,
    insulated: false,
    rng: world.config.seed >>> 0,
  };
  notice(
    g,
    places(world).find((p) => p.id === start)!.name +
      "で、新しい暮らしが始まった。",
  );
  for (const actor of actors) actor.mood = moodOf(g, actor);
  return g;
}

export function setBond(
  g: Game,
  first: string,
  second: string,
  kind: Bond,
): Game {
  if (
    !Object.hasOwn(bondNames, kind) ||
    first === second ||
    !find(g, first) ||
    !find(g, second)
  )
    return g;
  const n = structuredClone(g);
  find(n, first)!.relations[second] = relation(kind);
  find(n, second)!.relations[first] = relation(kind);
  for (const actor of n.actors) actor.mood = moodOf(n, actor);
  return n;
}
export function setPriority(g: Game, id: string, skill: Skill | null): Game {
  if (!find(g, id) || (skill !== null && !skillKeys.includes(skill))) return g;
  const n = structuredClone(g);
  find(n, id)!.priority = skill;
  return n;
}
export function setStock(g: Game, low: number, high: number): Game {
  if (!Number.isFinite(low) || !Number.isFinite(high)) return g;
  const n = structuredClone(g);
  const minimum = clamp(Math.floor(low), 0, 49);
  n.foodTarget = {
    low: minimum,
    high: clamp(Math.floor(high), minimum + 1, 50),
  };
  return n;
}
export function specialize(g: Game, id: string, skill: Skill): Game {
  const current = find(g, id);
  if (
    !current ||
    current.level < 2 ||
    current.specialty ||
    !skillKeys.includes(skill)
  )
    return g;
  const n = structuredClone(g);
  find(n, id)!.specialty = skill;
  notice(
    n,
    current.person.name + "は" + skillNames[skill] + "を専門に決めた。",
  );
  return n;
}

function skillGain(g: Game, a: Actor, s: Skill, diff: number, base: number) {
  const level = a.person.skills[s];
  // Familiar tasks still give a little practice; an expert needs challenging work to grow.
  const challenge = diff + 1 - level;
  const practice =
    challenge >= 0
      ? 1
      : challenge === -1
        ? 0.48
        : challenge === -2
          ? 0.15
          : 0.035;
  const xp = round1(
    base *
      practice *
      clamp((diff + 2) / (level + 2), 0.25, 1.75) *
      (a.person.talent === s ? 1.5 : 1) *
      (a.specialty === s ? 1.2 : 1),
  );
  a.experience = round1(a.experience + xp);
  a.xp[s] = round1(a.xp[s] + xp);
  while (
    a.person.skills[s] < 10 &&
    a.xp[s] >= skillThreshold(a.person.skills[s])
  ) {
    a.xp[s] -= skillThreshold(a.person.skills[s]);
    a.person.skills[s]++;
    notice(
      g,
      a.person.name +
        "の" +
        skillNames[s] +
        "がレベル" +
        a.person.skills[s] +
        "になった。",
    );
  }
  if (a.person.skills[s] >= 10) a.xp[s] = 0;
  while (a.experience >= personThreshold(a.level)) a.level++;
}
function moodOf(g: Game, a: Actor) {
  const needs = a.needs;
  const fulfilled =
    needKeys.reduce((sum, key) => sum + Math.min(75, needs[key]), 0) /
    (75 * needKeys.length);
  let socialEffect = 0;
  for (const other of g.actors) {
    if (
      a === other ||
      a.location !== other.location ||
      a.room !== other.room ||
      (g.housing && a.location === g.home && !housingTogether(g, a, other))
    )
      continue;
    const bond = a.relations[other.person.id];
    if (!bond) continue;
    socialEffect += clamp((bond.trust + bond.affection) / 12, -10, 9);
  }
  return Math.round(
    clamp(
      12 +
        fulfilled * 58 +
        clamp(socialEffect, -14, 14) +
        a.memories.reduce((sum, m) => sum + m.value, 0) -
        a.injury * 0.2,
    ),
  );
}
function dice(g: Game) {
  g.rng = (Math.imul(1664525, g.rng) + 1013904223) >>> 0;
  return g.rng / 4294967296;
}
function task(
  g: Game,
  a: Actor,
  kind: string,
  label: string,
  minutes: number,
  metric: Metric,
  target?: string,
): Task {
  return {
    kind,
    label,
    total: Math.max(1, Math.ceil(minutes)),
    remaining: Math.max(1, Math.ceil(minutes)),
    from: a.location,
    metric,
    mode: "direct",
    target,
    reserved: {},
  };
}
const needActions: Record<Need, string> = {
  hunger: "食事をとる",
  bladder: "用を足す",
  hygiene: "体を洗う",
  energy: "ひと眠りする",
  social: "人の声にふれる",
  fun: "好きなことをして休む",
};
function parseWork(
  target?: string,
): { skill: Skill; tier: keyof typeof difficulty } | null {
  const [skill, tier = "easy"] = (target ?? "").split(":");
  if (!skillKeys.includes(skill as Skill) || !Object.hasOwn(difficulty, tier))
    return null;
  return { skill: skill as Skill, tier: tier as keyof typeof difficulty };
}
function reservation(
  g: Game,
  a: Actor,
  t: Task,
  cost: Partial<Stock>,
): Task | string {
  const bag = account(g, a);
  if (stocks.some((k) => bag[k] < (cost[k] ?? 0)))
    return "使える食材・木材・食事・銀貨が足りません。";
  t.reserved = cost;
  return t;
}
const samePlace = (a: Actor, b: Actor) => a.location === b.location;
function canTeachHere(g: Game, a: Actor, b: Actor) {
  return (
    a !== b &&
    samePlace(a, b) &&
    (!g.housing ||
      a.location !== g.home ||
      (b.injury < 70 && housingTogether(g, a, b)))
  );
}
type Proposal = Task | HousingProposal;
function proposedTask(p: Proposal): Task {
  return "task" in p ? p.task : p;
}
function preview(p: Proposal | string): ActionPreview {
  if (typeof p === "string") return { disabled: p };
  return {
    minutes: "task" in p ? p.minutes : p.total,
    reserved: proposedTask(p).reserved,
    ...("task" in p && p.foodBundle && { foodBundle: p.foodBundle }),
    ...("task" in p && p.facility && { facility: p.facility }),
  };
}
const cookingRecipes = ["cook", "cook:easy", "cook:hard", "cook:master"];

function facilitySelectionReason(
  g: Game,
  a: Actor,
  kind: string,
  target: string | undefined,
  selection: FacilitySelection | undefined,
): string | undefined {
  if (selection === undefined) return;
  const woodworking = isBasicWoodwork(target);
  const recovery = kind === "recover" && target === undefined;
  if (
    !recovery &&
    (kind !== "work" || (!woodworking && !cookingRecipes.includes(target!)))
  )
    return "基本の木工・料理・療養の指示で設備を指定できます。";
  if (a.location !== g.home || !g.housing)
    return "自宅で住居の移動を使う暮らしを選んでください。";
  if (
    !selection ||
    typeof selection !== "object" ||
    Array.isArray(selection) ||
    (recovery && !Object.hasOwn(selection, "fixtureId")) ||
    typeof selection.fixtureId !== "string" ||
    !selection.fixtureId
  )
    return "使う設備を指定してください。";
  if (
    Object.hasOwn(selection, "bundleId") &&
    (typeof selection.bundleId !== "string" ||
      !selection.bundleId ||
      !["cook", "cook:easy"].includes(target!))
  )
    return "食材の一束は基本の野菜料理で選んでください。";
  const fixture = g.house.rooms
    .flatMap((room) => room.fixtures)
    .find((f) => f.id === selection.fixtureId);
  if (!fixture) return "選んだ設備がありません。";
  if (recovery) {
    if (fixture.kind !== "mat" && fixture.kind !== "bed")
      return "療養には寝床を選んでください。";
    const id = a.person.id;
    if (a.danger || g.housing.unlocated[id]?.reason === "regional-travel")
      return "移動や危険が落ち着いてから、自宅の寝床を選んでください。";
    if (a.injury >= 70 && !Object.hasOwn(g.housing.state.actors, id))
      return "重い傷で寝床まで移動できません。今いる場所で療養できます。";
    if (Object.keys(selection).some((key) => key !== "fixtureId"))
      return "療養に使う寝床を一つ選んでください。";
    return;
  }
  if (woodworking)
    return fixture.kind === "workbench"
      ? undefined
      : "木工には木工台を選んでください。";
  if (fixture.kind !== "hearth" && fixture.kind !== "kitchen")
    return "料理に使える設備を選んでください。";
}

function plan(
  g: Game,
  a: Actor,
  kind: string,
  target?: string,
  selection?: FacilitySelection,
): Proposal | string {
  const atHome = a.location === g.home;
  let fixtureId = selection?.fixtureId;
  if (kind === "home-use") {
    if (!atHome || !g.housing)
      return "自宅で住居の移動を使う暮らしを選んでください。";
    const fixture = g.house.rooms
      .flatMap((room) => room.fixtures)
      .find((f) => f.id === target);
    if (!fixture) return "選んだ設備がありません。";
    fixtureId = fixture.id;
    kind = "need";
    const need = furnishings[fixture.kind].need;
    if (need === null) return "木工台は基本の木工の指示で選んでください。";
    target = need;
  }
  const stock = account(g, a);
  const place = places(g.world).find((p) => p.id === a.location)!;
  if (a.injury >= 70 && !["need", "recover", "withdraw"].includes(kind))
    return "重い傷のため、休息か仲間の救助が必要です。";
  if (
    a.danger &&
    !["negotiate", "defend", "withdraw", "recover"].includes(kind)
  )
    return "道の人影に対して交渉・応戦・撤退を選んでください。";
  if (kind === "home-move") {
    if (!atHome || !g.housing)
      return "自宅で住居の移動を使う暮らしを選んでください。";
    return planHousing(
      g,
      a,
      task(g, a, kind, "指定した地点へ移動", 1, "travel", target),
    );
  }
  if (kind === "need" && needKeys.includes(target as Need)) {
    const key = target as Need;
    if (key === "hunger" && stock.food < 1) return "手元に食事がありません。";
    if (atHome) {
      if (g.housing) {
        const t = task(
          g,
          a,
          kind,
          needActions[key],
          1,
          key === "fun" ? "free" : "care",
          key,
        );
        if (key === "hunger") t.reserved = { food: 1 };
        return planHousing(g, a, t, key, place.water, fixtureId);
      }
      const busy = g.actors
        .filter((b) => b !== a && b.task?.station)
        .map((b) => b.task!.station!);
      const s = service(g.house, key, a.room, busy, place.water);
      if (!s) return "使える設備に空きがないか、通路から届きません。";
      const company = g.actors.some(
        (b) =>
          b !== a &&
          samePlace(a, b) &&
          b.room === s.room &&
          (!b.task || b.task.room === s.room),
      );
      const label =
        key === "social" && !company ? "便りを書いて過ごす" : s.title;
      const t = task(
        g,
        a,
        kind,
        label,
        s.minutes,
        key === "fun" ? "free" : "care",
        key,
      );
      t.room = s.room;
      t.station = s.station;
      return reservation(g, a, t, key === "hunger" ? { food: 1 } : {});
    }
    const fieldTime = {
      hunger: 13,
      bladder: 10,
      hygiene: 20 + place.water,
      energy: 90,
      social: 34,
      fun: 27,
    }[key];
    const t = task(
      g,
      a,
      kind,
      needActions[key],
      fieldTime,
      key === "fun" ? "free" : "care",
      key,
    );
    return reservation(g, a, t, key === "hunger" ? { food: 1 } : {});
  }
  if (kind === "work") {
    const w = parseWork(target);
    if (!w) return "仕事が見つかりません。";
    const { skill, tier } = w;
    if (
      tier === "master" &&
      a.person.skills[skill] < 5 &&
      a.specialty !== skill
    )
      return "この仕事は技能5か、その分野の専門化で開きます。";
    if (skill === "wood" && tier === "master") {
      if (!atHome) return "雨戸の取付工事は自宅で行います。";
      if (
        g.insulated ||
        g.actors.some((b) => b !== a && b.task?.target === "wood:master")
      )
        return "雨戸はすでに完成、または工事中です。";
    }
    if (skill === "trade" && a.location !== "village" && a.location !== "mill")
      return "商談は市場か水車の里でできます。";
    if (
      skill === "care" &&
      tier === "master" &&
      !g.actors.some((b) => canTeachHere(g, a, b) && b.injury < 70)
    )
      return g.housing && atHome
        ? "家の中で同じ地点に教える相手が必要です。"
        : "同じ場所に教える相手が必要です。";
    let minutes =
      { wood: 35, cook: 32, care: 30, trade: 27 }[skill] +
      (difficulty[tier] - 1) * 7;
    minutes *= clamp(
      1 - a.person.skills[skill] * 0.035 - a.mood * 0.001 + a.injury / 180,
      0.45,
      2,
    );
    if (skill === "cook" && !atHome) minutes += place.water + 8;
    const t = task(g, a, kind, jobNames[skill][tier], minutes, "work", target);
    if (skill === "wood" && selection)
      return planHousing(g, a, t, null, 0, selection.fixtureId);
    if (skill === "cook") {
      if (atHome) {
        if (g.housing) {
          if (!cookingRecipes.includes(target!))
            return "料理の種類を選んでください。";
          if (selection?.bundleId !== undefined)
            return planHousing(
              g,
              a,
              t,
              "hunger",
              0,
              fixtureId,
              selection.bundleId,
            );
          const reserved = reservation(g, a, t, {
            ingredients: tier === "easy" ? 2 : 3,
          });
          if (typeof reserved === "string") return reserved;
          return planHousing(g, a, t, "hunger", 0, fixtureId);
        }
        const busy = g.actors
          .filter((b) => b !== a && b.task?.station)
          .map((b) => b.task!.station!);
        const kitchen = cookingStation(g.house, a.room, busy);
        if (!kitchen) return "使える料理設備が空いていません。";
        t.station = kitchen.station;
        t.room = kitchen.room;
        t.total += kitchen.minutes;
        t.remaining = t.total;
      }
      return reservation(g, a, t, { ingredients: tier === "easy" ? 2 : 3 });
    }
    if (skill === "wood" && tier === "master")
      return reservation(g, a, t, { wood: 3 });
    if (skill === "trade")
      return reservation(g, a, t, { wood: tier === "easy" ? 1 : 2 });
    return t;
  }
  if (kind === "buy") {
    if (a.location !== "village") return "食事を買えるのは町の市場です。";
    if (g.time % 1440 < 480 || g.time % 1440 > 1065)
      return "営業時間（8〜18時）に来てください。";
    if (mealSpace(g, account(g, a)) < 1)
      return "食事を受け取る空きがありません。";
    const pending = g.actors.filter(
      (b) => b !== a && b.task?.kind === "buy",
    ).length;
    if (g.world.trade.stock <= pending)
      return "市場の食事在庫が予約分を含めて尽きています。";
    return reservation(
      g,
      a,
      task(g, a, kind, "市場で食事を一食買う", 12, "work"),
      { coins: g.world.trade.stock > 4 ? 1 : 2 },
    );
  }
  if (kind === "forage")
    return task(
      g,
      a,
      kind,
      "食材を採集する",
      20 + place.water + (place.biome === "forest" ? 0 : 8),
      "work",
    );
  if (kind === "pack" || kind === "unpack") {
    if (!atHome) return "荷物を整えるには家に戻ってください。";
    const packAmounts: Stock = { wood: 4, food: 2, ingredients: 3, coins: 4 };
    if (!stocks.includes(target as keyof Stock))
      return "荷物を選んでください。";
    const key = target as keyof Stock;
    if (kind === "unpack" && a.cargo[key] < 1) return "荷物にありません。";
    if (key === "food") {
      if (kind === "unpack" && mealSpace(g) === 0)
        return "共有備蓄に食事を下ろせる空きがありません。";
      if (kind === "pack" && mealSpace(g, a.cargo) < packAmounts.food)
        return "荷物に食事を積む空きがありません。";
    }
    const t = task(
      g,
      a,
      kind,
      kind === "pack" ? "旅の荷物を積む" : "旅の荷物を下ろす",
      3,
      "work",
      key,
    );
    return kind === "pack"
      ? reservation(g, a, t, { [key]: packAmounts[key] })
      : t;
  }
  if (kind === "travel" || kind === "return" || kind === "withdraw") {
    if (kind === "withdraw" && !a.danger)
      return "いま対峙している相手はいません。";
    const destination = kind === "travel" ? target : g.home;
    if (!destination) return "行き先を選んでください。";
    if (destination === a.location && kind !== "withdraw")
      return "すでに到着しています。";
    const distance = travelMinutes(g.world, a.location, destination);
    if (!Number.isFinite(distance)) return "通れる道が見つかりません。";
    const load =
      a.cargo.wood * 1.1 + a.cargo.food * 0.35 + a.cargo.ingredients * 0.25;
    const factor =
      1 +
      a.injury / 75 +
      Math.max(0, load - (a.person.body === "sturdy" ? 7 : 4)) / 14;
    const minutes = Math.max(kind === "withdraw" ? 15 : 1, distance * factor);
    const name =
      places(g.world).find((p) => p.id === destination)?.name ?? "家";
    return task(
      g,
      a,
      kind,
      (kind === "withdraw" ? "退路をたどり" : "") + name + "へ移動",
      minutes,
      "travel",
      destination,
    );
  }
  if (kind === "explore")
    return task(
      g,
      a,
      kind,
      "人の往来から外れて探索する",
      28 + place.water,
      "travel",
    );
  if (kind === "negotiate" || kind === "defend") {
    if (!a.danger) return "いま対峙している相手はいません。";
    return task(
      g,
      a,
      kind,
      kind === "negotiate" ? "道を譲ってもらう交渉" : "仲間のために道を守る",
      18,
      "work",
    );
  }
  if (kind === "practice") {
    if (a.practicedOn === day(g))
      return "得意を伸ばす自由研究は今日は終えました。通常の仕事は続けられます。";
    const skill = a.person.likes;
    const names: Record<Skill, string> = {
      wood: "小さな木彫りをひとつ彫る",
      cook: "季節の食材で試作する",
      trade: "各地の相場を書き比べる",
      care: "身近な薬草を見分ける",
    };
    const t = task(g, a, kind, names[skill], 42, "free");
    return reservation(
      g,
      a,
      t,
      skill === "wood"
        ? { wood: 1 }
        : skill === "cook"
          ? { ingredients: 1 }
          : {},
    );
  }
  if (kind === "leisure") {
    const names: Record<Skill, string> = {
      wood: "道具を手入れして木目を眺める",
      cook: "次に作りたい献立を考える",
      trade: "市で聞いた話を手帳にまとめる",
      care: "野草の絵を手帳に描く",
    };
    return task(g, a, kind, names[a.person.likes], 48, "free");
  }
  if (kind === "recover") {
    const rest = task(
      g,
      a,
      kind,
      "傷をいたわって休む",
      recoveryUseMinutes,
      "care",
    );
    return selection
      ? planHousing(g, a, rest, "energy", 0, selection.fixtureId)
      : rest;
  }
  if (["talk", "argue", "court", "aid", "rescue"].includes(kind)) {
    const peer = find(g, target ?? "");
    if (!peer || peer === a || !samePlace(a, peer))
      return "相手と同じ場所にいる必要があります。";
    if (atHome && g.housing && !housingTogether(g, a, peer))
      return "家の中で、二人が同じ地点に立っている必要があります。";
    if (
      (peer.task && (peer.task.mode === "direct" || peer.task.partner)) ||
      peer.danger
    )
      return "相手が別の行動中です。";
    if (kind === "court" && a.relations[peer.person.id]?.kind === "family")
      return "家族には別の交流を選んでください。";
    if ((kind === "aid" || kind === "rescue") && peer.injury <= 0)
      return "相手に手当ての必要はありません。";
    if (kind === "rescue" && atHome)
      return "家に着いています。ここで手当てできます。";
    if (!["aid", "rescue"].includes(kind) && peer.injury >= 70)
      return "会話より手当てが必要です。";
    const titles: Record<string, string> = {
      talk: "話を聞く",
      argue: "不満を伝える",
      court: "想いを伝える",
      aid: "傷を手当てする",
      rescue: "家まで付き添う",
    };
    const minutes =
      kind === "rescue"
        ? Math.max(20, travelMinutes(g.world, a.location, g.home) * 1.55)
        : kind === "aid"
          ? 32
          : 22;
    const t = task(
      g,
      a,
      kind,
      peer.person.name +
        ({ talk: "の", argue: "に", court: "に", aid: "の", rescue: "に" }[
          kind
        ] ?? "に") +
        titles[kind],
      minutes,
      kind === "rescue" ? "travel" : kind === "aid" ? "care" : "free",
      target,
    );
    t.partner = peer.person.id;
    return t;
  }
  if (kind === "project" && target) {
    const p = projectInfo(g.world, target);
    if (!p || !p.allowed) return p?.reason || "今はできない地域の仕事です。";
    if (p.placeId !== a.location)
      return "この仕事をする場所へ移動してください。";
    if (
      g.actors.some(
        (b) =>
          b !== a && b.task?.kind === "project" && b.task.target === target,
      )
    )
      return "ほかの住人がすでに取り組んでいます。";
    return reservation(
      g,
      a,
      task(g, a, kind, p.label, p.minutes, "work", target),
      { wood: p.wood, coins: p.coins },
    );
  }
  if (kind === "wait")
    return task(g, a, kind, "周りが空くのを待つ", 5, "waiting");
  return "今はその行動を選べません。";
}

function stop(g: Game, a: Actor, spatialCancelled = false): void {
  const t = a.task;
  if (!t) return;
  if (t.spatial?.benchRecoveryId) {
    cancelBenchActor(g, a.person.id);
    return;
  }
  if (t.spatial?.foodBundleId) {
    cancelFoodActor(g, a);
    return;
  }
  if (t.spatial?.constructionId) {
    cancelConstructionActor(g, a.person.id);
    return;
  }
  if (t.spatial?.gatheringId) {
    cancelGatheringMember(g, a.person.id);
    return;
  }
  if (t.spatial && !spatialCancelled && !cancelHousingTask(g, a, t)) return;
  if (t.follower && t.partner) {
    const leader = find(g, t.partner);
    if (leader?.task?.partner === a.person.id) {
      stop(g, leader);
      return;
    }
  }
  refundReservation(g, a, t);
  a.task = null;
  housingTaskBoundary(g, a, t, "cancel");
  finishLodgingWalk(g, a, t, true);
  if (t.partner) {
    const b = find(g, t.partner);
    if (b?.task?.partner === a.person.id) {
      const follower = b.task;
      b.task = null;
      housingTaskBoundary(g, b, follower, "cancel");
      b.reason = "相手の予定が変わりました。";
    }
  }
}
function begin(
  g: Game,
  a: Actor,
  proposal: Proposal,
  why: string,
  auto = false,
) {
  const t = proposedTask(proposal);
  if ("task" in proposal) {
    g.housing!.state = proposal.state;
    delete g.housing!.unlocated[a.person.id];
    if (proposal.foodBundle) {
      presentFood(g.housing)!.assignment = {
        kind: "cook",
        actorId: a.person.id,
        orderId: t.spatial!.orderId,
      };
      refreshFoodHandling(g.housing!);
    }
  }
  if (t.partner) {
    const peer = find(g, t.partner)!;
    if (peer.task) stop(g, peer);
    peer.task = {
      ...t,
      partner: a.person.id,
      follower: true,
      mode: auto ? "auto" : "direct",
      reserved: {},
    };
    peer.reason = a.person.name + "と一緒に過ごします。";
    if (a.location === g.home && !g.housing) peer.room = a.room;
    housingTaskBoundary(g, peer, peer.task, "begin");
  }
  const bag = account(g, a);
  for (const key of stocks) bag[key] -= t.reserved[key] ?? 0;
  t.mode = auto ? "auto" : "direct";
  a.task = t;
  a.reason = why;
  housingTaskBoundary(g, a, t, "begin");
}
export function order(
  g: Game,
  id: string,
  kind: string,
  target?: string,
  selection?: FacilitySelection,
): Game {
  if (!find(g, id)) return g;
  const next = structuredClone(g);
  const a = find(next, id)!;
  const selectionReason = facilitySelectionReason(
    next,
    a,
    kind,
    target,
    selection,
  );
  if (selectionReason) {
    notice(next, selectionReason);
    return next;
  }
  if (kind !== "cancel" && housingInTransit(next, id)) {
    notice(next, safeExitReason);
    return next;
  }
  if (
    kind === "cancel" &&
    a.task?.kind === "home-haul" &&
    a.task.mode === "auto" &&
    a.task.spatial?.foodBundleId &&
    next.housing?.foodSupply
  )
    next.housing.foodSupply.enabled = false;
  if (a.task) stop(next, a);
  if (kind === "cancel") {
    if (a.task?.spatial) {
      if (
        !a.task.spatial.constructionId &&
        !a.task.spatial.foodBundleId &&
        !a.task.spatial.benchRecoveryId
      )
        a.reason = "この区間を出ると予定を取り消し、予約を返します。";
      return next;
    }
    a.reason = "指示を取り消しました。次の時間進行で自分の予定を選びます。";
    notice(next, a.person.name + "が予定を取り消した。");
    return next;
  }
  const t = plan(next, a, kind, target, selection);
  if (typeof t === "string") {
    const unchanged = structuredClone(g);
    notice(unchanged, t);
    return unchanged;
  }
  begin(next, a, t, "直接の指示で、" + proposedTask(t).label + "。");
  return next;
}
export function inspectOrder(
  g: Game,
  id: string,
  kind: string,
  target?: string,
  selection?: FacilitySelection,
): ActionPreview {
  const current = find(g, id);
  if (!current) return { disabled: "住人が見つかりません。" };
  const selectionReason = facilitySelectionReason(
    g,
    current,
    kind,
    target,
    selection,
  );
  if (selectionReason) return { disabled: selectionReason };
  if (g.housing && kind === "cancel")
    return current.task ? {} : { disabled: "取り消す予定がありません。" };
  if (housingInTransit(g, id)) return { disabled: safeExitReason };
  const snap = current.task ? structuredClone(g) : g;
  const a = find(snap, id)!;
  if (a.task) stop(snap, a);
  return preview(plan(snap, a, kind, target, selection));
}
export function options(g: Game, id: string): ActionOption[] {
  if (!find(g, id)) return [];
  const snap = find(g, id)!.task ? structuredClone(g) : g;
  const a = find(snap, id)!;
  const inTransit = housingInTransit(g, id);
  if (a.task && !inTransit) stop(snap, a);
  const out: ActionOption[] = [];
  function add(
    kind: string,
    label: string,
    group: OptionGroup,
    target?: string,
  ) {
    const details = inTransit
      ? { disabled: safeExitReason }
      : preview(plan(snap, a, kind, target));
    out.push({ kind, label, target, group, ...details });
  }
  if (find(g, id)!.task)
    out.push({ kind: "cancel", label: "現在の予定を取り消す", group: "task" });
  for (const n of needKeys) add("need", needActions[n], "need", n);
  add("leisure", "好きなことに自由時間を使う", "need");
  add("practice", "好きな技能で一日一度の自由研究", "work");
  for (const s of skillKeys)
    for (const tier of Object.keys(difficulty) as (keyof typeof difficulty)[]) {
      add(
        "work",
        jobNames[s][tier],
        "work",
        tier === "easy" ? s : s + ":" + tier,
      );
    }
  add("forage", "食材を採集する", "work");
  add("buy", "市場で食事を買う", "work");
  for (const b of snap.actors.filter((b) => b !== a)) {
    const n = b.person.name;
    add("talk", n + "と話す", "relation", b.person.id);
    add("court", n + "に想いを伝える", "relation", b.person.id);
    add("argue", n + "に不満を伝える", "relation", b.person.id);
    if (b.injury > 0) {
      add("aid", n + "の傷を手当てする", "field", b.person.id);
      if (b.location !== g.home)
        add("rescue", n + "に付き添って帰る", "field", b.person.id);
    }
  }
  if (a.location === g.home) {
    const amounts = {
      wood: "木材4",
      food: "食事2",
      ingredients: "食材3",
      coins: "銀貨4",
    };
    for (const k of stocks) {
      add("pack", amounts[k] + "を旅の荷物に積む", "field", k);
      if (a.cargo[k] > 0)
        add(
          "unpack",
          amounts[k].replace(/[0-9]/g, "") + "を荷物から下ろす",
          "field",
          k,
        );
    }
  } else add("return", "家に帰る", "field");
  add("explore", "道を離れて探索する", "field");
  if (a.danger) {
    add("negotiate", "道を譲ってもらう交渉", "field");
    add("defend", "道を守る", "field");
    add("withdraw", "撤退して帰る", "field");
  }
  if (a.injury > 0) add("recover", "傷をいたわって休む", "field");
  return out;
}

function tryAuto(
  g: Game,
  a: Actor,
  kind: string,
  target: string | undefined,
  reason: string,
  free = false,
): boolean {
  const t = plan(g, a, kind, target);
  if (typeof t === "string") return false;
  if (free) proposedTask(t).metric = "free";
  begin(g, a, t, reason, true);
  return true;
}
function autoPartners(g: Game, a: Actor, qualifies: (peer: Actor) => boolean) {
  const candidates = g.actors.filter(
    (peer) => peer !== a && samePlace(a, peer) && !peer.task && qualifies(peer),
  );
  // Old and regional decisions tried only the first matching resident.
  return g.housing && a.location === g.home
    ? candidates
    : candidates.slice(0, 1);
}
function chooseShift(
  g: Game,
  a: Actor,
  skill: Skill,
  appointed: boolean,
): boolean {
  const bag = account(g, a);
  const atHome = a.location === g.home;
  const woodGoal = atHome
    ? 14 + g.actors.length * 4
    : a.person.body === "sturdy"
      ? 9
      : 6;
  const foodGoal = atHome ? g.foodTarget.high : 4;
  const reason = appointed
    ? "担当の" + skillNames[skill] + "を進めます。"
    : "好きな" + skillNames[skill] + "を選びました。";
  const work = (field: Skill, tier: "easy" | "hard", message: string) => {
    if (
      !tryAuto(
        g,
        a,
        "work",
        tier === "easy" ? field : field + ":hard",
        message,
        !appointed,
      )
    )
      return false;
    a.nextShift = g.time + (appointed ? 280 : 560);
    return true;
  };
  const tier = a.person.skills[skill] >= 3 ? "hard" : "easy";
  if (skill === "wood" && bag.wood >= woodGoal) return false;
  if (skill === "cook") {
    if (bag.food >= foodGoal) return false;
    if (bag.ingredients < (tier === "easy" ? 2 : 3))
      return tryAuto(
        g,
        a,
        "forage",
        undefined,
        "料理のために材料を集めます。",
        !appointed,
      );
  }
  if (skill === "trade") {
    if (a.location !== "village" && a.location !== "mill") return false;
    if (g.time % 1440 < 480 || g.time % 1440 > 1020) return false;
    if (bag.wood < (tier === "hard" ? 2 : 1))
      return work("wood", "easy", "次回の商いに備えて、売る木材を整えます。");
  }
  if (skill === "care") {
    for (const patient of autoPartners(g, a, (peer) => peer.injury > 0)) {
      if (
        tryAuto(g, a, "aid", patient.person.id, "傷のある仲間を手当てします。")
      )
        return true;
    }
  }
  return work(skill, tier, reason);
}
function selectAuto(g: Game, a: Actor) {
  if (a.danger) {
    tryAuto(g, a, "withdraw", undefined, "危険な道から家へ戻ります。");
    return;
  }
  if (a.injury >= 50) {
    tryAuto(g, a, "recover", undefined, "傷が重いため体を休めます。");
    return;
  }
  const stock = account(g, a);
  const lowest = needKeys
    .filter((k) => a.needs[k] < 42)
    .sort((x, y) => a.needs[x] - a.needs[y]);
  for (const n of lowest) {
    if (n === "hunger" && stock.food === 0) {
      if (tryAuto(g, a, "work", "cook", "空腹なので、残った食材を煮ます。"))
        return;
      if (
        stock.ingredients < 2 &&
        tryAuto(g, a, "forage", undefined, "食事に使う食材を探します。")
      )
        return;
    }
    if (
      tryAuto(
        g,
        a,
        "need",
        n,
        needNames[n] + "が下がったので、" + needActions[n] + "。",
      )
    )
      return;
  }
  if (a.mood < 25 && a.strainUntil <= g.time) {
    a.strainUntil = g.time + 180;
    memory(g, a, "ひと息つく時間", 4, 120);
    if (
      tryAuto(
        g,
        a,
        "need",
        "fun",
        "重なった疲れをほどくため、仕事をひと休みします。",
        true,
      )
    )
      return;
  }
  if (a.location === g.home && g.stocking) {
    if (tryAuto(g, a, "work", "cook", "備蓄方針に従い、家の食事を補います。"))
      return;
    if (
      g.ingredients < 2 &&
      tryAuto(
        g,
        a,
        "forage",
        undefined,
        "食事の備蓄を補うために食材を集めます。",
      )
    )
      return;
  }
  const minute = g.time % 1440;
  const daytime = minute >= 420 && minute < 1180;
  if (
    !daytime &&
    a.needs.energy < 77 &&
    tryAuto(g, a, "need", "energy", "夜のうちに体を休めます。")
  )
    return;
  if (daytime && tryFoodSupply(g, a)) return;
  const ready = daytime && g.time >= a.nextShift;
  if (ready && a.priority && chooseShift(g, a, a.priority, true)) return;
  if (a.person.personality === "social" && a.needs.social < 65) {
    const companions = autoPartners(
      g,
      a,
      (peer) => !peer.danger && (a.relations[peer.person.id]?.trust ?? 0) >= 0,
    );
    for (const companion of companions) {
      if (
        tryAuto(
          g,
          a,
          "talk",
          companion.person.id,
          companion.person.name + "と話して過ごしたいようです。",
          true,
        )
      )
        return;
    }
  }
  if (
    a.person.personality === "quiet" &&
    a.needs.fun < 65 &&
    tryAuto(g, a, "need", "fun", "一人で気分転換できる時間を選びました。", true)
  )
    return;
  if (
    ready &&
    a.priority !== a.person.likes &&
    chooseShift(g, a, a.person.likes, false)
  )
    return;
  if (
    daytime &&
    a.practicedOn !== day(g) &&
    tryAuto(
      g,
      a,
      "practice",
      undefined,
      "仕事が一段落したので、好きな分野の小さな試作をします。",
      true,
    )
  )
    return;
  if (
    tryAuto(
      g,
      a,
      "leisure",
      undefined,
      a.nextShift > g.time
        ? "今日の仕事に区切りをつけ、好きなことをして過ごします。"
        : "暮らしの用事が落ち着いたので、自由時間にします。",
      true,
    )
  )
    return;
  tryAuto(g, a, "wait", undefined, "使える設備が空くのを待っています。");
}
function refundReservation(g: Game, a: Actor, t: Task) {
  const bag = account(g, a);
  for (const key of stocks) {
    const count = t.reserved[key] ?? 0;
    if (key === "food" && bag === g) refundMeal(g, count);
    else bag[key] += count;
  }
}
function unload(g: Game, a: Actor, key: keyof Stock) {
  const count =
    key === "food" ? Math.min(a.cargo.food, mealSpace(g)) : a.cargo[key];
  g[key] += count;
  a.cargo[key] -= count;
  return key === "food" && a.cargo.food
    ? "共有備蓄に入らない食事" + a.cargo.food + "食は荷物に残しました。"
    : "";
}
function returnCargo(g: Game, a: Actor) {
  return stocks.map((key) => unload(g, a, key)).join("");
}
function finishWork(g: Game, a: Actor, t: Task): string {
  const w = parseWork(t.target)!;
  const { skill, tier } = w,
    level = a.person.skills[skill],
    diff = difficulty[tier];
  const performance =
    level + Math.floor(a.mood / 35) + (a.specialty === skill ? 2 : 0);
  const sound = performance >= diff;
  const strength =
    1 + Math.floor(level / 3) + (sound && tier !== "easy" ? 2 : 0);
  const bag = account(g, a);
  let result = "";
  if (skill === "wood") {
    const yieldWood =
      strength +
      (places(g.world).find((p) => p.id === a.location)?.biome === "forest"
        ? 1
        : 0);
    if (tier === "master") {
      g.insulated = true;
      memory(g, a, "仕上げた建具への誇り", 6, 600);
      result =
        "雨戸の断熱改修が完成した。初霜を過ぎても家で体力を消耗しにくくなった。";
    } else {
      if (!isStockQuantity(bag.wood + yieldWood))
        return "木材を置く空きがないため、木工を中断しました。";
      bag.wood += yieldWood;
      result = "木材" + yieldWood + "を整えた。";
    }
  }
  if (skill === "cook") {
    const servings = 2 + strength;
    if (t.spatial?.foodBundleId) {
      const bundle = presentFood(g.housing)!;
      if (mealSpace(g, bag) < servings) {
        delete bundle.assignment;
        refreshFoodHandling(g.housing!);
        return "完成食を置く空きがないため、料理を中断し、一束を設備の使用床に残しました。";
      }
      settleFood(g, bundle, "consumed");
    } else if (mealSpace(g, bag) < servings) {
      refundReservation(g, a, t);
      return "完成食を置く空きがないため、料理を中断して食材を戻しました。";
    }
    bag.food += servings;
    result = "食事を" + servings + "食用意した。";
  }
  if (skill === "trade") {
    const coins = strength + (tier === "easy" ? 1 : 2);
    bag.coins += coins;
    if (a.location === "village")
      g.world.trade.stock = Math.min(18, g.world.trade.stock + 1);
    if (tier === "master" && sound) {
      const contract = a.memories.find((m) => m.label === "木材の継続契約");
      if (!contract) memory(g, a, "木材の継続契約", 5, 1440 * 3);
    }
    result = "木材を銀貨" + coins + "枚に換えた。";
  }
  if (skill === "care") {
    result = "手当ての手順を覚えた。";
    if (tier === "master") {
      // A newly accepted home lesson requires a located teacher. Only an old
      // lesson can finish at home with its teacher's position still unspecified.
      const unlocated = g.housing?.unlocated;
      const continuingLegacyLesson =
        !!unlocated &&
        Object.hasOwn(unlocated, a.person.id) &&
        unlocated[a.person.id].reason === "legacy-unspecified";
      const pupil = g.actors.find((b) =>
        continuingLegacyLesson
          ? b !== a && samePlace(a, b)
          : canTeachHere(g, a, b),
      );
      if (pupil) {
        skillGain(g, pupil, skill, 3, 12);
        result += pupil.person.name + "も手当てを学んだ。";
      }
    }
  }
  skillGain(g, a, skill, diff, sound ? 13 : 8);
  if (skill === a.person.likes) a.practicedOn = day(g);
  if (a.person.likes === skill) {
    a.needs.fun = clamp(a.needs.fun + 10);
    memory(g, a, "好きな" + skillNames[skill], 6, 180);
  }
  if (a.person.dislikes === skill)
    memory(g, a, "苦手な気持ちをこらえた" + skillNames[skill], -7, 150);
  return result;
}
function finish(g: Game, a: Actor, t: Task) {
  const bag = account(g, a),
    peer = t.partner ? find(g, t.partner) : undefined;
  a.task = null;
  if (peer?.task?.partner === a.person.id) {
    peer.task = null;
    peer.reason = "一緒の予定を終えました。";
  }
  if (t.room) a.room = t.room;
  let result = "";
  if (t.kind === "need") {
    const n = t.target as Need;
    const gain: Record<Need, number> = {
      hunger: 56,
      bladder: 72,
      hygiene: 64,
      energy: 61,
      social: 40,
      fun: 47,
    };
    a.needs[n] = clamp(a.needs[n] + gain[n]);
    if (n === "social") {
      const spatial = t.spatial;
      const solo = spatial
        ? !spatial.socialCompany
        : t.label === "便りを書いて過ごす";
      if (solo) a.needs.social = clamp(a.needs.social - 15);
      if (
        a.person.personality === "social" &&
        (!spatial || spatial.socialCompany)
      )
        memory(g, a, "人の声に元気づけられた", 4, 150);
      if (spatial)
        result = solo
          ? "便りを書いて過ごしました。"
          : "居合わせた人と語らいました。";
    }
    if (n === "fun" && a.person.personality === "quiet")
      memory(g, a, "静かな自由時間", 6, 230);
    if (n === "energy") a.injury = clamp(a.injury - 2);
    if (n === "hunger" && g.housing) {
      const companions = Object.keys(t.spatial?.mealPartners ?? {});
      if (companions.length) a.needs.social = clamp(a.needs.social + 9);
      for (const id of companions) {
        const mate = find(g, id)!;
        memory(
          g,
          a,
          mate.person.name + "と囲んだ食卓",
          (a.relations[id]?.trust ?? 0) >= 0 ? 4 : -4,
          180,
        );
      }
    } else if (n === "hunger") {
      const mate = g.actors.find(
        (b) =>
          b !== a &&
          samePlace(a, b) &&
          b.task?.kind === "need" &&
          b.task.target === "hunger" &&
          b.task.room === t.room,
      );
      if (mate) {
        a.needs.social = clamp(a.needs.social + 9);
        mate.needs.social = clamp(mate.needs.social + 9);
        const good = (a.relations[mate.person.id]?.trust ?? 0) >= 0;
        memory(g, a, mate.person.name + "と囲んだ食卓", good ? 4 : -4, 180);
        memory(
          g,
          mate,
          a.person.name + "と囲んだ食卓",
          (mate.relations[a.person.id]?.trust ?? 0) >= 0 ? 4 : -4,
          180,
        );
      }
    }
  } else if (t.kind === "work") result = finishWork(g, a, t);
  else if (t.kind === "forage") {
    const place = places(g.world).find((p) => p.id === a.location)!;
    const cold = day(g) >= place.frost;
    const amount = Math.max(
      2,
      (place.biome === "forest" || place.id === "orchard" ? 5 : 3) -
        (cold ? 1 : 0),
    );
    bag.ingredients += amount;
    result = "食材を" + amount + "つ見つけた。";
  } else if (t.kind === "buy") {
    if (g.world.trade.stock > 0 && mealSpace(g, bag) > 0) {
      g.world.trade.stock--;
      bag.food++;
      result = "食事を一食受け取った。";
    } else {
      bag.coins += t.reserved.coins ?? 0;
      result =
        g.world.trade.stock > 0
          ? "食事を置く空きがないため銀貨が戻った。"
          : "売り切れのため銀貨が戻った。";
    }
  } else if (t.kind === "pack" || t.kind === "unpack") {
    const key = t.target as keyof Stock;
    if (t.kind === "pack") {
      const count = t.reserved[key] ?? 0;
      if (key === "food" && mealSpace(g, a.cargo) < count) {
        refundMeal(g, count);
        result = "荷物に空きがないため、食事を共有備蓄に戻しました。";
      } else a.cargo[key] += count;
    } else result = unload(g, a, key);
  } else if (["travel", "return", "withdraw"].includes(t.kind)) {
    a.location = t.target!;
    a.room = a.location === g.home ? "living" : "outdoors";
    a.danger = false;
    result =
      places(g.world).find((p) => p.id === a.location)!.name + "に到着した。";
    if (a.location === g.home) result += returnCargo(g, a);
    if (a.person.personality === "curious")
      memory(g, a, "外の景色を見た", 5, 180);
  } else if (t.kind === "explore") {
    const place = places(g.world).find((p) => p.id === a.location)!;
    if (place.biome === "ridge" || dice(g) < 0.42) {
      a.danger = true;
      result = "行く手に人影が現れた。交渉、応戦、撤退を選べる。";
    } else {
      bag.ingredients += 3;
      bag.wood++;
      result = "食材3つと木材1つを持ち帰った。";
    }
  } else if (t.kind === "negotiate" || t.kind === "defend") {
    const negotiating = t.kind === "negotiate";
    const advantage =
      (negotiating ? a.person.skills.trade : a.person.skills.care) +
      (a.person.body === "sturdy" && !negotiating ? 2 : 0);
    a.danger = false;
    if (dice(g) < clamp(0.43 + advantage * 0.065, 0.2, 0.92)) {
      bag.coins += 3;
      result = "道が開き、旅人から銀貨3枚を受け取った。";
      memory(g, a, "道を開いた安堵", 6, 280);
    } else {
      a.injury = clamp(a.injury + (negotiating ? 18 : 38));
      result = "引き返す途中で傷を負った。";
      memory(g, a, "道で怖い思いをした", -9, 500);
    }
    skillGain(g, a, negotiating ? "trade" : "care", 4, 14);
  } else if (t.kind === "practice") {
    const skill = a.person.likes;
    a.practicedOn = day(g);
    skillGain(g, a, skill, Math.min(4, a.person.skills[skill] + 1), 11);
    a.needs.fun = clamp(a.needs.fun + 22);
    memory(g, a, skillNames[skill] + "の小さな試作", 7, 240);
    result = t.label + "時間を楽しんだ。";
  } else if (t.kind === "leisure") {
    a.needs.fun = clamp(a.needs.fun + 19);
    if (a.person.personality === "quiet")
      memory(g, a, "静かな自由時間", 5, 160);
  } else if (t.kind === "recover") {
    a.injury = clamp(a.injury - 12);
    a.needs.energy = clamp(a.needs.energy + 27);
    result = "傷を休めた。";
  } else if (
    peer &&
    ["talk", "argue", "court", "aid", "rescue"].includes(t.kind)
  ) {
    const x = a.relations[peer.person.id],
      y = peer.relations[a.person.id];
    if (t.kind === "aid" || t.kind === "rescue") {
      if (t.kind === "aid") {
        peer.injury = clamp(peer.injury - 16 - a.person.skills.care * 3);
        skillGain(g, a, "care", 3, 16);
      } else {
        for (const p of [a, peer]) {
          p.location = g.home;
          p.room = "living";
          p.danger = false;
          const remaining = returnCargo(g, p);
          if (remaining) result += p.person.name + "の" + remaining;
        }
      }
      y.trust = clamp(y.trust + 12, -100, 100);
      memory(g, peer, a.person.name + "に助けられた", 10, 1440);
    } else {
      const hostile = t.kind === "argue",
        romantic = t.kind === "court";
      const mutual =
        romantic && y.trust >= 15 && y.kind !== "family" && y.kind !== "rival";
      x.trust = clamp(x.trust + (hostile ? -8 : 3), -100, 100);
      y.trust = clamp(
        y.trust + (hostile ? -15 : romantic && !mutual ? -2 : 6),
        -100,
        100,
      );
      x.affection = clamp(
        x.affection + (hostile ? -5 : romantic ? 12 : 2),
        -100,
        100,
      );
      y.affection = clamp(
        y.affection + (hostile ? -9 : romantic ? (mutual ? 14 : -2) : 3),
        -100,
        100,
      );
      if (mutual && Math.min(x.affection, y.affection) >= 45) {
        x.kind = "lover";
        y.kind = "lover";
      }
      for (const [rel, p, other] of [
        [x, a, peer],
        [y, peer, a],
      ] as const) {
        if (rel.kind !== "family" && rel.kind !== "lover") {
          if (rel.trust <= -38) rel.kind = "rival";
          else if (rel.trust >= 25) rel.kind = "friend";
          else if (rel.kind === "rival" && rel.trust >= -5)
            rel.kind = "neutral";
        }
        p.needs.social = clamp(p.needs.social + (hostile ? 9 : 24));
        const value = hostile
          ? p === peer
            ? -11
            : -6
          : romantic && !mutual
            ? -4
            : 7;
        memory(
          g,
          p,
          other.person.name +
            (hostile
              ? "との言い争い"
              : romantic
                ? "に伝えた気持ち"
                : "と交わした話"),
          value,
          hostile ? 580 : 310,
        );
      }
      result = romantic
        ? mutual
          ? "気持ちが通じた。"
          : "相手は、まだ気持ちを決めかねている。"
        : "";
    }
  } else if (t.kind === "project" && t.target) {
    const p = projectInfo(g.world, t.target);
    if (p?.allowed && p.placeId === a.location) {
      result = applyProject(g.world, t.target);
      if (t.target === "deliver") {
        bag.coins += 2;
        result += "銀貨2枚を受け取った。";
      }
      skillGain(g, a, t.target === "bridge" ? "wood" : "trade", 4, 20);
    } else {
      refundReservation(g, a, t);
      result = "条件が変わったため、予約を解いた。";
    }
  }
  housingTaskBoundary(g, a, t, "finish");
  if (peer) housingTaskBoundary(g, peer, t, "finish");
  const lodging = finishLodgingWalk(g, a, t, false) ?? usualHomeArrival(g, a, t);
  if (lodging) result += lodging;
  a.reason = result || "「" + t.label + "」を終えました。";
  if (t.kind !== "wait")
    notice(g, a.person.name + "　" + (result || t.label + "。"));
}

const decay: Record<Need, number> = {
  hunger: 0.12,
  bladder: 0.16,
  hygiene: 0.065,
  energy: 0.095,
  social: 0.055,
  fun: 0.07,
};
function advanceMinute(g: Game): boolean {
  if (g.food <= g.foodTarget.low) g.stocking = true;
  if (g.food >= g.foodTarget.high) g.stocking = false;
  for (const a of g.actors) if (!a.task && !a.danger) selectAuto(g, a);
  g.time++;
  if (g.time % 1440 === 0) {
    dayWorld(g.world);
    for (const a of g.actors) {
      if (
        a.memories.some(
          (m) => m.label === "木材の継続契約" && m.until > g.time,
        ) &&
        g.wood > 0
      ) {
        g.wood--;
        g.coins += 4;
        notice(g, a.person.name + "の継続契約で木材1を銀貨4枚に換えた。");
      }
    }
  }
  prepareBenchMinute(g);
  const releasedReturns = prepareConstructionMinute(g);
  prepareFoodMinute(g);
  // Crossing a doorway cannot retroactively change exposure during that minute.
  recordRoomStayMinute(g);
  const protectedActors = new Set(
    g.actors.filter((a) => homeColdProtection(g, a)).map((a) => a.person.id),
  );
  const spatialMinutes = g.housing
    ? advanceHousingMinute(g, heldGatheringOrders(g))
    : undefined;
  let completedFood: { a: Actor; t: Task } | undefined;
  let returnedFood: (() => void) | undefined;
  const completed: { a: Actor; t: Task }[] = [];
  for (const a of g.actors) {
    const t = a.task;
    const spatial = spatialMinutes?.get(a.person.id);
    const metric = spatial?.metric ?? t?.metric ?? "waiting";
    a.metrics[metric]++;
    const moving = metric === "travel";
    const frost =
      day(g) >= places(g.world).find((p) => p.id === a.location)!.frost &&
      !protectedActors.has(a.person.id);
    for (const k of needKeys) {
      let rate = decay[k];
      if (k === "energy" && moving) rate *= 1.45;
      if (k === "energy" && frost) rate *= a.person.body === "cold" ? 1.6 : 1.2;
      if (k === "social")
        rate *=
          a.person.personality === "social"
            ? 1.35
            : a.person.personality === "quiet"
              ? 0.72
              : 1;
      if (
        (t?.kind === "need" && t.target === k && (!spatial || spatial.used)) ||
        (t?.kind === "home-gather" &&
          spatial?.used &&
          k === (t.target === "meal" ? "hunger" : "social"))
      )
        rate *= 0.3;
      a.needs[k] = clamp(a.needs[k] - rate);
    }
    a.memories = a.memories.filter((m) => m.until > g.time);
    a.mood = moodOf(g, a);
    if (t?.spatial?.foodBundleId && spatial) {
      if (t.spatial.kind === "use" && spatial.terminal === "finish")
        completedFood = { a, t };
      else returnedFood = finishFoodHaul(g, a, spatial);
    } else if (
      t &&
      !t.spatial?.gatheringId &&
      !t.spatial?.constructionId &&
      !t.spatial?.benchRecoveryId
    ) {
      if (!spatial) t.remaining--;
      if (spatial?.terminal === "cancel") {
        stop(g, a, true);
        a.reason = "区間の終点で予定を取り消し、予約を解除しました。";
      } else if (
        (spatial?.terminal === "finish" || (!spatial && t.remaining === 0)) &&
        !t.follower
      )
        completed.push({ a, t });
      else if (
        t.mode === "auto" &&
        !t.partner &&
        t.metric === "work" &&
        a.mood < 20 &&
        a.strainUntil <= g.time
      ) {
        stop(g, a);
        a.strainUntil = g.time + 180;
        memory(g, a, "無理をして疲れた", -4, 120);
        if (!a.task)
          tryAuto(
            g,
            a,
            "need",
            "energy",
            "つらい気持ちが続き、仕事を中断して休みます。",
          );
      }
    }
  }
  const completedBench = spatialMinutes && finishBenchMinute(g, spatialMinutes);
  const completedPlan =
    spatialMinutes && g.housing!.construction
      ? finishConstructionMinute(g, spatialMinutes, releasedReturns)
      : undefined;
  if (spatialMinutes && Object.keys(g.housing!.gatherings ?? {}).length) {
    finishGatheringMinute(g, spatialMinutes);
    for (const a of g.actors) a.mood = moodOf(g, a);
  }
  let encounter = false;
  // Resolve the bundle against all ordinary stock changes on this tick.
  if (completedFood) completed.push(completedFood);
  for (const { a, t } of completed) {
    if (a.task !== t) continue;
    finish(g, a, t);
    a.mood = moodOf(g, a);
    if (a.danger && t.kind === "explore") encounter = true;
  }
  if (completed.length) for (const a of g.actors) a.mood = moodOf(g, a);
  settleMealReturns(g);
  returnedFood?.();
  // Ordinary stock changes for this minute get accounted for before newly released bundles.
  for (const { plan, worker } of releasedReturns)
    settleConstructionReturn(g, plan, worker);
  // Other orders may also have ended this minute. Validate only after all their Task bindings settle.
  if (completedPlan)
    Object.assign(g, completeRoomConstruction(g, completedPlan).game);
  if (completedBench) settleBenchFinish(g, completedBench);
  return encounter;
}
export function advance(g: Game, minutes: number): Game {
  if (!Number.isFinite(minutes) || minutes < 1) return g;
  const n = structuredClone(g);
  const count = Math.min(1440 * 31, Math.floor(minutes));
  for (let i = 0; i < count; i++) if (advanceMinute(n)) break;
  return n;
}

function object(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function number(v: unknown, min = 0, max = 1e9): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
}
function integer(v: unknown, min = 0, max = 1e9): v is number {
  return number(v, min, max) && Number.isInteger(v);
}
function short(v: unknown, max = 320): v is string {
  return typeof v === "string" && v.length <= max;
}
function validMemories(
  memories: unknown,
  ownerId: string,
  actorIds: ReadonlySet<string>,
) {
  if (!Array.isArray(memories) || memories.length > 100) return false;
  const identities = new Set<string>();
  for (const m of memories) {
    if (
      !object(m) ||
      !short(m.label) ||
      !number(m.value, -100, 100) ||
      !integer(m.until)
    )
      return false;
    if (!Object.hasOwn(m, "gathering")) continue;
    const source = m.gathering;
    if (
      !object(source) ||
      Object.keys(source).length !== 2 ||
      !Object.hasOwn(source, "kind") ||
      !Object.hasOwn(source, "peerId") ||
      (source.kind !== "talk" && source.kind !== "meal") ||
      typeof source.peerId !== "string" ||
      !actorIds.has(source.peerId) ||
      source.peerId === ownerId
    )
      return false;
    const key = JSON.stringify([source.kind, source.peerId]);
    if (identities.has(key)) return false;
    identities.add(key);
  }
  return true;
}
function numericKeys(
  value: unknown,
  keys: readonly string[],
  max = 1e9,
): boolean {
  return object(value) && keys.every((key) => number(value[key], 0, max));
}
export function isStockQuantity(value: unknown): value is number {
  return integer(value, 0, stockLimit);
}
function goodStock(value: unknown): boolean {
  return object(value) && stocks.every((k) => isStockQuantity(value[k]));
}
function hasKind(value: unknown): value is Skill {
  return skillKeys.includes(value as Skill);
}
const metrics: Metric[] = ["free", "work", "care", "travel", "waiting"];
const actionKinds = [
  "home-dismantle",
  "home-salvage",
  "home-build",
  "home-haul",
  "home-gather",
  "home-move",
  "need",
  "work",
  "buy",
  "forage",
  "pack",
  "unpack",
  "travel",
  "return",
  "withdraw",
  "explore",
  "negotiate",
  "defend",
  "recover",
  "talk",
  "argue",
  "court",
  "aid",
  "rescue",
  "project",
  "wait",
  "leisure",
  "practice",
];
export function isGame(value: unknown): value is Game {
  if (
    !object(value) ||
    value.version !== 1 ||
    !isWorld(value.world) ||
    !isHouse(value.house) ||
    !goodStock(value) ||
    !integer(value.time, 480) ||
    !integer(value.rng, 0, 0xffffffff) ||
    typeof value.stocking !== "boolean" ||
    typeof value.insulated !== "boolean" ||
    !object(value.foodTarget) ||
    !integer(value.foodTarget.low, 0, 49) ||
    !integer(value.foodTarget.high, 1, 50) ||
    value.foodTarget.high <= value.foodTarget.low ||
    !Array.isArray(value.log) ||
    value.log.length > 100 ||
    !value.log.every((s) => short(s, 1100)) ||
    !Array.isArray(value.actors) ||
    value.actors.length < 1 ||
    value.actors.length > 3
  )
    return false;
  const world = value.world,
    house = value.house,
    homes = new Set(house.rooms.map((r) => r.id));
  const siteIds = new Set(world.sites.map((site) => site.id));
  if (!short(value.home) || !siteIds.has(value.home)) return false;
  const validRoomId = (id: unknown): id is string =>
    value.housing === undefined
      ? short(id)
      : typeof id === "string" && id.length > 0;
  const actors = value.actors;
  const ids = new Set<string>();
  for (const a of actors) {
    if (
      !object(a) ||
      !isPersona(a.person) ||
      ids.has(a.person.id) ||
      !skillKeys.every((k) => integer((a.person as Persona).skills[k], 0, 10))
    )
      return false;
    ids.add(a.person.id);
  }
  const stations = new Set<string>();
  for (const a of actors) {
    if (
      !object(a) ||
      !isPersona(a.person) ||
      !short(a.location) ||
      !siteIds.has(a.location) ||
      !validRoomId(a.room) ||
      (a.location === value.home
        ? !homes.has(a.room)
        : a.room !== "outdoors") ||
      !numericKeys(a.needs, needKeys, 100) ||
      !numericKeys(a.xp, skillKeys) ||
      !short(a.reason) ||
      !number(a.mood, 0, 100) ||
      !number(a.injury, 0, 100) ||
      !integer(a.level, 1) ||
      !number(a.experience) ||
      !integer(a.strainUntil) ||
      !integer(a.nextShift) ||
      !integer(a.practicedOn) ||
      typeof a.danger !== "boolean" ||
      !goodStock(a.cargo) ||
      !numericKeys(a.metrics, metrics) ||
      (a.priority !== null && !hasKind(a.priority)) ||
      (a.specialty !== null && !hasKind(a.specialty)) ||
      !validMemories(a.memories, a.person.id, ids) ||
      !object(a.relations) ||
      Object.keys(a.relations).length !== actors.length - 1
    )
      return false;
    for (const [id, r] of Object.entries(a.relations)) {
      if (
        !ids.has(id) ||
        id === a.person.id ||
        !object(r) ||
        !short(r.kind) ||
        !Object.hasOwn(bondNames, r.kind) ||
        !number(r.trust, -100, 100) ||
        !number(r.affection, -100, 100)
      )
        return false;
    }
    if (a.task === null) continue;
    const t = a.task;
    if (
      !object(t) ||
      !short(t.kind) ||
      !actionKinds.includes(t.kind) ||
      !short(t.label) ||
      !integer(t.remaining, 1) ||
      !integer(t.total, 1) ||
      t.remaining > t.total ||
      t.from !== a.location ||
      !metrics.includes(t.metric as Metric) ||
      !["direct", "auto"].includes(t.mode as string) ||
      !object(t.reserved) ||
      Object.entries(t.reserved).some(
        ([k, v]) => !(stocks as readonly string[]).includes(k) || !integer(v),
      ) ||
      (t.target !== undefined &&
        (t.kind === "home-move"
          ? typeof t.target !== "string"
          : !short(t.target))) ||
      (t.room !== undefined && (!validRoomId(t.room) || !homes.has(t.room))) ||
      (t.partner !== undefined &&
        (!short(t.partner) ||
          !ids.has(t.partner) ||
          t.partner === a.person.id)) ||
      (t.follower !== undefined && typeof t.follower !== "boolean")
    )
      return false;
    if (
      (t.kind === "home-dismantle" ||
        t.kind === "home-salvage" ||
        t.kind === "home-haul" ||
        t.kind === "home-build" ||
        t.kind === "home-gather") &&
      (!value.housing || !t.spatial)
    )
      return false;
    if (
      value.housing === undefined &&
      (t.spatial !== undefined || t.kind === "home-move")
    )
      return false;
    if (t.station !== undefined && t.spatial === undefined) {
      if (
        t.kind === "recover" ||
        !short(t.station) ||
        stations.has(t.station) ||
        a.location !== value.home
      )
        return false;
      const fixtureId = t.station.split("#")[0];
      if (
        !house.rooms.some(
          (r) =>
            r.id === t.room &&
            r.fixtures.some(
              (f) => f.id === fixtureId && f.kind !== "workbench",
            ),
        )
      )
        return false;
      stations.add(t.station);
    }
    if (t.kind === "work" && !parseWork(t.target as string)) return false;
    if (t.kind === "need" && !needKeys.includes(t.target as Need)) return false;
    if (
      ["pack", "unpack"].includes(t.kind) &&
      !(stocks as readonly unknown[]).includes(t.target)
    )
      return false;
    if (
      ["travel", "return", "withdraw"].includes(t.kind) &&
      !siteIds.has(t.target as string)
    )
      return false;
    if (t.kind === "project" && !projectInfo(world, t.target as string))
      return false;
    const paired = ["talk", "argue", "court", "aid", "rescue"].includes(t.kind);
    if (paired !== !!t.partner || (t.follower && !paired)) return false;
    if (t.partner) {
      const b = actors.find((other) => other.person.id === t.partner);
      if (
        !b ||
        b.location !== a.location ||
        !b.task ||
        b.task.kind !== t.kind ||
        b.task.partner !== a.person.id ||
        !!b.task.follower === !!t.follower ||
        b.task.remaining !== t.remaining
      )
        return false;
    }
  }
  if (!validMealReturns(value as unknown as Game)) return false;
  return (
    value.housing === undefined ||
    isHousingRuntime(value.housing, value as unknown as Game)
  );
}
