export type Climate = "cool" | "mild" | "warm";
export type Biome = "forest" | "meadow" | "ridge" | "shore";
export const biomeNames: Record<Biome, string> = {
  forest: "森",
  meadow: "草原",
  ridge: "丘陵",
  shore: "水辺",
};
export const climateNames: Record<Climate, string> = {
  cool: "冷涼",
  mild: "温和",
  warm: "温暖",
};

export interface LandmarkRule {
  id: string;
  name: string;
  npc: string;
  kind: "guild" | "village" | "facility" | "faction";
  required: boolean;
  preference: Biome;
  temperature?: "any" | "cold" | "warm";
  anchor: "village" | "mill";
  reach: number;
}
export interface WorldConfig {
  seed: number;
  climate: Climate;
  woods: number;
  roads: number;
  river: "stream" | "river";
  townName: string;
  millName: string;
  pinnedTownSeed: number | null;
  rules: LandmarkRule[];
}
export interface Place {
  id: string;
  name: string;
  x: number;
  y: number;
  biome: Biome;
  water: number;
  market: number;
  frost: number;
}
interface Road {
  a: string;
  b: string;
  minutes: number;
  kind: "road" | "ferry" | "bridge";
}
interface Landmark extends LandmarkRule {
  placeId: string;
  trust: number;
  lastVisit: number;
}
export interface World {
  config: WorldConfig;
  sites: Place[];
  routes: Road[];
  landmarks: Landmark[];
  bridge: boolean;
  trade: {
    day: number;
    ferry: number;
    bridge: number;
    road: string[];
    stock: number;
    millStock: number;
    deliveries: number;
    deliveredDay: number;
  };
}

export function defaultWorldConfig(): WorldConfig {
  return {
    seed: 5317,
    climate: "mild",
    woods: 2,
    roads: 2,
    river: "river",
    townName: "白露の町",
    millName: "水車の里",
    pinnedTownSeed: null,
    rules: [
      {
        id: "apothecary",
        name: "北の薬師組合",
        npc: "ナギ",
        kind: "guild",
        required: true,
        preference: "forest",
        anchor: "village",
        reach: 75,
      },
    ],
  };
}

function rng(seed: number) {
  let state = Math.imul(seed ^ (seed >>> 16), 0x85ebca6b);
  state = Math.imul(state ^ (state >>> 13), 0xc2b2ae35);
  state = (state ^ (state >>> 16)) >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
function stringSeed(s: string) {
  let result = 2166136261;
  for (const char of s)
    result = Math.imul(result ^ char.charCodeAt(0), 16777619);
  return result >>> 0;
}
export function riverX(y: number, seed: number) {
  return (
    50 +
    3.2 * Math.sin(y * 0.092 + (seed % 17) * 0.19) +
    1.75 * Math.cos(y * 0.16)
  );
}
function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function path(
  world: World,
  from: string,
  to: string,
): { minutes: number; ids: string[] } {
  if (
    !world.sites.some((s) => s.id === from) ||
    !world.sites.some((s) => s.id === to)
  )
    return { minutes: Infinity, ids: [] };
  const options = [{ minutes: 0, ids: [from] }];
  const seen = new Set<string>();
  while (options.length) {
    options.sort((a, b) => a.minutes - b.minutes);
    const p = options.shift()!;
    const id = p.ids[p.ids.length - 1];
    if (seen.has(id)) continue;
    if (id === to) return p;
    seen.add(id);
    for (const route of world.routes) {
      if (route.kind === "bridge" && !world.bridge) continue;
      const next =
        route.a === id ? route.b : route.b === id ? route.a : undefined;
      if (next && !seen.has(next))
        options.push({
          minutes: p.minutes + route.minutes,
          ids: [...p.ids, next],
        });
    }
  }
  return { minutes: Infinity, ids: [] };
}
export function travelMinutes(world: World, from: string, to: string): number {
  return path(world, from, to).minutes;
}

function updateTravel(world: World) {
  for (const site of world.sites)
    site.market = travelMinutes(world, site.id, "village");
}

export function generateWorld(input: WorldConfig): World {
  const config: WorldConfig = structuredClone(input);
  const r = rng(config.seed);
  const townR = rng(config.pinnedTownSeed ?? config.seed);
  const direction = townR() > 0.5 ? -1 : 1;
  const west = (x: number) => (direction === 1 ? x : 100 - x);
  const townAtTop = townR() >= 0.5;
  const townY = (townAtTop ? 24 : 73) + townR() * 8;
  const opposedY = Math.round(100 - townY);
  const meadow =
    config.woods >= 3 || (config.woods === 2 && r() < 0.5)
      ? "forest"
      : "meadow";
  function site(
    id: string,
    name: string,
    x: number,
    y: number,
    biome: Biome,
    water: number,
  ): Place {
    const frost = { cool: 12, mild: 21, warm: 32 }[config.climate];
    return {
      id,
      name,
      x: Math.round(west(x)),
      y: Math.round(y),
      biome,
      water,
      market: 0,
      frost: Math.max(
        3,
        frost + Math.round((y - 50) / 13) - (biome === "ridge" ? 3 : 0),
      ),
    };
  }
  const sites = [
    site(
      "village",
      config.townName.trim() || "白露の町",
      21 + townR() * 7,
      townY,
      "meadow",
      4,
    ),
    site("landing", "柳の渡し", 37 + r() * 4, 47 + r() * 8, "shore", 1),
    site(
      "forest",
      config.woods === 1 ? "木立の原" : "雑木の森",
      15 + r() * 14,
      opposedY + r() * 4,
      meadow,
      5 + Math.round(r() * 7),
    ),
    site(
      "mill",
      config.millName.trim() || "水車の里",
      69 + r() * 7,
      townY + r() * 6 - 3,
      "shore",
      2,
    ),
    site(
      "orchard",
      "対岸の果樹園",
      63 + r() * 9,
      50 + r() * 6 - 3,
      config.woods === 3 ? "forest" : "meadow",
      4 + Math.round(r() * 5),
    ),
    site(
      "pass",
      "風見の峠",
      75 + r() * 8,
      opposedY + r() * 5 - 3,
      "ridge",
      10 + Math.round(r() * 6),
    ),
  ];
  const road = (
    a: string,
    b: string,
    base: number,
    kind: Road["kind"] = "road",
  ): Road => ({
    a,
    b,
    kind,
    minutes: Math.max(
      3,
      Math.round(base * (1.15 - config.roads * 0.1) + r() * 4),
    ),
  });
  const routes = [
    road("village", "landing", 18),
    road("landing", "forest", 24),
    ...(config.roads === 3 || r() > 0.4
      ? [road("village", "forest", 37 + r() * 13)]
      : []),
    road("mill", "orchard", 17),
    road("orchard", "pass", 27),
    ...(config.roads === 3 || r() > 0.4
      ? [road("pass", "mill", 38 + r() * 15)]
      : []),
    road("landing", "orchard", config.river === "river" ? 21 : 12, "ferry"),
    road("village", "mill", 13, "bridge"),
  ];
  const world: World = {
    config,
    sites,
    routes,
    landmarks: [],
    bridge: false,
    trade: {
      day: 1,
      ferry: 0,
      bridge: 0,
      road: [],
      stock: 4,
      millStock: 5,
      deliveries: 0,
      deliveredDay: 0,
    },
  };
  updateTravel(world);
  for (const rule of config.rules) {
    const toss = rng(config.seed ^ stringSeed(rule.id));
    if (!rule.required && toss() > 0.58) continue;
    const maxWalk =
      rule.kind === "village" && rule.reach >= 4 ? rule.reach - 4 : rule.reach;
    const eligible = sites.filter(
      (p) => travelMinutes(world, p.id, rule.anchor) <= maxWalk,
    );
    const weights = eligible.map((p) => {
      const climateWeight =
        rule.temperature === "cold"
          ? 1 + (38 - p.frost) / 4
          : rule.temperature === "warm"
            ? 1 + p.frost / 4
            : 1;
      return (
        ((p.biome === rule.preference ? 8 : 1) * climateWeight) /
        (1 + world.landmarks.filter((l) => l.placeId === p.id).length)
      );
    });
    let ticket = toss() * weights.reduce((total, weight) => total + weight, 0);
    const index = weights.findIndex((weight) => {
      ticket -= weight;
      return ticket < 0;
    });
    const host = eligible[Math.max(0, index)];
    let placeId = host.id;
    // A new village can found a hamlet on a side road. A rule explicitly set to
    // 'in town' stays within the parent town, as do offices and individual NPCs.
    const available = rule.reach - travelMinutes(world, host.id, rule.anchor);
    if (rule.kind === "village" && available >= 4) {
      const walk = Math.min(available, 4 + Math.floor(toss() * 8));
      const angle = toss() * Math.PI * 2;
      placeId = "hamlet-" + rule.id;
      const projectedX = clamp(
        Math.round(host.x + Math.cos(angle) * 10),
        10,
        90,
      );
      const y = clamp(Math.round(host.y + Math.sin(angle) * 16), 12, 90);
      const nearBank = Math.round(riverX(y, config.seed));
      const x =
        host.x < riverX(host.y, config.seed)
          ? Math.min(projectedX, nearBank - 4)
          : Math.max(projectedX, nearBank + 4);
      sites.push({
        ...host,
        id: placeId,
        name: rule.name.trim() || "小さな集落",
        x,
        y,
        water: host.water + 2,
        market: host.market + walk,
      });
      routes.push({ a: host.id, b: placeId, minutes: walk, kind: "road" });
    }
    const name =
      rule.name.trim() ||
      {
        guild: "町の組合",
        facility: "小さな工房",
        village: "小さな集落",
        faction: "谷の一団",
      }[rule.kind];
    world.landmarks.push({
      ...rule,
      name,
      npc: rule.npc.trim() || "世話役",
      placeId,
      trust: 0,
      lastVisit: 0,
    });
  }
  world.trade.road = path(world, "mill", "village").ids;
  return world;
}

export function places(world: World): Place[] {
  return world.sites;
}

export function dayWorld(world: World): void {
  const trade = world.trade;
  const route = path(world, "mill", "village");
  trade.day += 1;
  // A merchant has one working morning in which to complete round trips and load up.
  const escorts = world.landmarks.filter(
    (l) => l.kind === "faction" && l.trust >= 2,
  ).length;
  const journeys = clamp(
    Math.floor((200 + escorts * 35) / (2 * route.minutes + 24)),
    1,
    5,
  );
  const cold = trade.day >= world.sites.find((p) => p.id === "mill")!.frost;
  const supply = Math.min(18, trade.millStock + (cold ? 1 : 3));
  const delivered = Math.min(journeys, supply);
  trade.millStock = supply - delivered;
  trade.stock = clamp(trade.stock - 2 + delivered, 0, 18);
  trade.road = route.ids;
  if (route.ids.includes("landing")) {
    trade.ferry += delivered;
  } else {
    trade.bridge += delivered;
  }
}

export interface RegionalProject {
  placeId: string;
  minutes: number;
  wood: number;
  coins: number;
  allowed: boolean;
  label: string;
  reason: string;
}
export function projectInfo(
  world: World,
  command: string,
): RegionalProject | undefined {
  if (command === "bridge")
    return {
      placeId: "landing",
      minutes: 90,
      wood: Math.max(
        2,
        4 -
          world.landmarks.filter((l) => l.kind === "facility" && l.trust >= 2)
            .length,
      ),
      coins: 0,
      allowed: !world.bridge,
      label: "市場と水車の里を橋で結ぶ",
      reason: world.bridge ? "橋はすでに開通しています。" : "",
    };
  if (command === "deliver")
    return {
      placeId: "village",
      minutes: 30,
      wood: 1,
      coins: 0,
      allowed:
        world.trade.deliveredDay !== world.trade.day && world.trade.stock < 18,
      label: "市場へ荷を納める",
      reason:
        world.trade.stock >= 18
          ? "市場の倉は満杯です。"
          : "今日の荷はすでに納めました。",
    };
  const l =
    command === "negotiate"
      ? world.landmarks[0]
      : world.landmarks.find((l) => command === "visit:" + l.id);
  if (l)
    return {
      placeId: l.placeId,
      minutes: 30,
      wood: 0,
      coins: 0,
      allowed: l.lastVisit !== world.trade.day,
      label: l.npc + "と地域の仕事を相談する",
      reason: "今日の話し合いは終わりました。",
    };
}
export function applyProject(world: World, command: string): string {
  const info = projectInfo(world, command);
  if (!info) return "地域の仕事が見つかりません。";
  if (!info.allowed) return info.reason;
  if (command === "bridge") {
    world.bridge = true;
    updateTravel(world);
    return "橋が開通しました。対岸へ直接渡れます。明朝の荷車は新しい最短路を選びます。";
  }
  if (command === "deliver") {
    world.trade.stock = Math.min(18, world.trade.stock + 2);
    world.trade.deliveries++;
    world.trade.deliveredDay = world.trade.day;
    return "市場へ建材を納め、店頭の在庫が2増えました。";
  }
  const l =
    command === "negotiate"
      ? world.landmarks[0]
      : world.landmarks.find((l) => command === "visit:" + l.id)!;
  l.trust++;
  l.lastVisit = world.trade.day;
  if (l.trust >= 2) {
    if (l.kind === "facility")
      return l.name + "が橋用の資材の提供を約束しました。";
    if (l.kind === "faction")
      return (
        l.name + "が商人の護送に加わりました。明朝から荷車が長く往来できます。"
      );
    if (l.kind === "village") {
      world.trade.stock = Math.min(18, world.trade.stock + 2);
      return l.name + "から市場へ生活物資が2つ届きました。";
    }
    world.trade.millStock = Math.min(18, world.trade.millStock + 2);
    return l.npc + "が仕入れに協力し、水車の里に荷を2つ用意しました。";
  }
  return (
    l.name +
    "の" +
    l.npc +
    "と顔見知りになりました。別の日にもう一度訪ねると、仕入れを頼めます。"
  );
}

function numeric(v: unknown, min: number, max: number): v is number {
  return (
    typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max
  );
}
function record(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
function str(v: unknown, length: number) {
  return typeof v === "string" && v.length <= length;
}
function oneOf<T>(v: unknown, choices: readonly T[]) {
  return choices.includes(v as T);
}

export function isWorldConfig(value: unknown): value is WorldConfig {
  if (
    !record(value) ||
    !numeric(value.seed, 0, 4294967295) ||
    !oneOf(value.climate, ["cool", "mild", "warm"]) ||
    !numeric(value.woods, 1, 3) ||
    !numeric(value.roads, 1, 3) ||
    !oneOf(value.river, ["stream", "river"]) ||
    !str(value.townName, 18) ||
    !str(value.millName, 18) ||
    !(
      value.pinnedTownSeed === null ||
      numeric(value.pinnedTownSeed, 0, 4294967295)
    ) ||
    !Array.isArray(value.rules) ||
    value.rules.length > 12
  )
    return false;
  const ids = new Set<string>();
  return value.rules.every((rule) => {
    if (
      !record(rule) ||
      typeof rule.id !== "string" ||
      !/^[\w-]{1,64}$/.test(rule.id) ||
      ids.has(rule.id) ||
      !str(rule.name, 20) ||
      !str(rule.npc, 16) ||
      !oneOf(rule.kind, ["guild", "village", "facility", "faction"]) ||
      typeof rule.required !== "boolean" ||
      !oneOf(rule.preference, Object.keys(biomeNames)) ||
      !oneOf(rule.temperature, [undefined, "any", "warm", "cold"]) ||
      !oneOf(rule.anchor, ["village", "mill"]) ||
      !numeric(rule.reach, 0, 360)
    )
      return false;
    ids.add(rule.id);
    return true;
  });
}

export function isWorld(value: unknown): value is World {
  if (
    !record(value) ||
    !isWorldConfig(value.config) ||
    typeof value.bridge !== "boolean" ||
    !record(value.trade) ||
    !Array.isArray(value.landmarks) ||
    !Array.isArray(value.sites) ||
    !Array.isArray(value.routes)
  )
    return false;
  const ref = generateWorld(value.config);
  ref.bridge = value.bridge;
  updateTravel(ref);
  function sameFields(actual: unknown, expected: object) {
    if (!record(actual)) return false;
    return Object.entries(expected).every(
      ([key, item]) => actual[key] === item,
    );
  }
  if (
    value.sites.length !== ref.sites.length ||
    !value.sites.every((s, i) => sameFields(s, ref.sites[i])) ||
    value.routes.length !== ref.routes.length ||
    !value.routes.every((s, i) => sameFields(s, ref.routes[i])) ||
    value.landmarks.length !== ref.landmarks.length
  )
    return false;
  const {
    day,
    stock,
    millStock,
    ferry,
    bridge,
    deliveries,
    deliveredDay,
    road,
  } = value.trade;
  if (
    !numeric(day, 1, 1e9) ||
    !numeric(stock, 0, 18) ||
    !numeric(millStock, 0, 18) ||
    !numeric(ferry, 0, 1e10) ||
    !numeric(bridge, 0, 1e10) ||
    !numeric(deliveries, 0, day) ||
    !numeric(deliveredDay, 0, day) ||
    !Array.isArray(road) ||
    road.length < 2 ||
    road.length > ref.sites.length ||
    road[0] !== "mill" ||
    road[road.length - 1] !== "village" ||
    new Set(road).size !== road.length ||
    !road
      .slice(1)
      .every((b, i) =>
        ref.routes.some(
          (r) =>
            (r.kind !== "bridge" || ref.bridge) &&
            ((r.a === road[i] && r.b === b) || (r.b === road[i] && r.a === b)),
        ),
      )
  )
    return false;
  return value.landmarks.every((l, i) => {
    const {
      trust: _trust,
      lastVisit: _lastVisit,
      ...fields
    } = ref.landmarks[i];
    return (
      record(l) &&
      sameFields(l, fields) &&
      numeric(l.trust, 0, day) &&
      numeric(l.lastVisit, 0, day)
    );
  });
}
