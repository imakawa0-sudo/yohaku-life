import { getPresentEncounterAt } from "./encounters";
import type { GameState, Resident, ResidentRoutine, WishKind } from "./types";
import { ensureInventory } from "./inventory";
import { createRegionState, LODGE_KEEPER, REGION_NPCS, regionNPCsAt, validRegion, type RegionNpcId } from "./region";
import { isCoinChoice } from "./currency";

type RecruitDefinition = {
  id: RegionNpcId;
  name: string;
  role: string;
  traits: string[];
  wish: string;
  wishKind: WishKind;
  routine: ResidentRoutine;
  skills: Resident["skills"];
  weapon: Resident["weapon"];
};

/** Membership and profiles share this registry. */
export const RECRUIT_DEFINITIONS: readonly RecruitDefinition[] = [
  {
    id: "village-guide", name: "ハル", role: "道案内と手仕事",
    traits: ["周りをよく見る", "静かな作業が好き"],
    wish: "仲間と食事をとり、自分の居場所を見つけたい", wishKind: "settle",
    routine: { workRole: "support", home: "home", leisure: "quiet" },
    skills: { cooking: 2, combat: 4, craft: 3 }, weapon: "staff",
  },
  {
    id: LODGE_KEEPER.id, name: "ナギ", role: "舟宿番と料理",
    traits: ["舟の手入れが得意", "食卓で話すのが好き"],
    wish: "仲間と食卓を囲んで、新しい暮らしになじみたい", wishKind: "settle",
    routine: { workRole: "cook", home: "kitchen", leisure: "social" },
    skills: { cooking: 4, combat: 2, craft: 4 }, weapon: "staff",
  },
];

const FOUNDERS = ["aki", "mio", "ren"] as const;
const awake = (person: Resident) => person.hp > 0 && person.action?.kind !== "sleep";
const whole = (value: unknown, min = 0): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= min;
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

export type RecruitmentStatus = {
  available: boolean;
  error?: string;
  title: string;
  text: string;
  trust: number;
  requiredTrust: 3;
  alreadyJoined: boolean;
  mealProgress?: { days: number; ateToday: boolean };
};

function lodgeMealDays(s: GameState, actorId: string, until: number, beforeId: number): Set<number> {
  const days = new Set<number>();
  if (!Array.isArray(s.life?.events)) return days;
  for (const event of s.life.events) {
    if (!event || event.kind !== "meal" || event.location !== LODGE_KEEPER.location
      || !whole(event.time) || event.time > until || event.time % 1440 < 480 || event.time % 1440 >= 1080
      || !whole(event.id, 1) || event.id >= beforeId
      || !Array.isArray(event.lodgeMealFinishers) || !event.lodgeMealFinishers.includes(actorId)) continue;
    days.add(Math.floor(event.time / 1440));
  }
  return days;
}

/** Pure projections also work on old saves without inventory or regional state. */
export function getRecruitmentStatus(s: GameState, actorId: string, npcId: string): RecruitmentStatus {
  const definition = RECRUIT_DEFINITIONS.find((entry) => entry.id === npcId);
  const lodge = npcId === LODGE_KEEPER.id;
  const trust = npcId === "village-guide" ? s.region?.trust["village-guide"]?.[actorId] ?? 0 : 0;
  const days = lodge ? lodgeMealDays(s, actorId, s.minutes, s.nextId) : undefined;
  const alreadyJoined = s.residents.some((person) => person.id === npcId);
  const result: RecruitmentStatus = {
    available: false, title: lodge ? "ナギを暮らしに誘う" : "仲間に誘う", trust, requiredTrust: 3, alreadyJoined,
    ...(days ? { mealProgress: { days: Math.min(2, days.size), ateToday: days.has(Math.floor(s.minutes / 1440)) } } : {}),
    text: lodge
      ? "舟宿の工房で、別々の日に二度、昼の時間に食事を終えた本人がナギを誘えます。"
      : definition
      ? "道の話を聞き、自分で食事を届けて信用を得た住民が、暮らしに誘えます。加入は任意です。"
      : "この相手を暮らしに誘うことはできません。",
  };
  const fail = (error: string): RecruitmentStatus => ({ ...result, error });
  if (!definition) return fail("この相手を暮らしに誘うことはできません。");
  if (alreadyJoined) return fail(`${definition.name}はすでに仲間です。`);
  const actor = s.residents.find((person) => person.id === actorId);
  if (!actor) return fail("誘う住民を一人選んでください。");
  if (s.ended) return fail("この試行は終了しています。保存から再開してください。");
  const npc = REGION_NPCS.find((person) => person.id === definition.id)!;
  const place = lodge ? "舟宿の工房" : "近隣の集落";
  if (actor.location !== npc.location) return fail(`${actor.name}が${place}にいる時に誘えます。`);
  if (!regionNPCsAt(s, actor.location).some((person) => person.id === npcId))
    return fail(`${place}で誘えるのは08:00から18:00までです。`);
  if (!awake(actor)) return fail(`${actor.name}は今、誘いに応じてもらえる状態ではありません。`);
  if ([actor.action, actor.suspended].some((action) => action && ["move", "rescue", "attack", "defend"].includes(action.kind)))
    return fail("移動・救助・交戦の指示を終えるか、取り消してから誘ってください。");
  if (actor.hp <= 35 && s.residents.some((carrier) => carrier.id !== actor.id && carrier.hp > 0
    && carrier.location === actor.location && [carrier.action, carrier.suspended].some((action) => action?.kind === "rescue" && action.target === actor.id)))
    return fail("運ばれている住民は、今は誘えません。");
  if ((getPresentEncounterAt(s, actor.location)?.hp ?? 0) > 0)
    return fail("交戦の現場では、仲間に誘えません。");
  if (days) {
    if (days.size < 2) return fail(days.has(Math.floor(s.minutes / 1440))
      ? "今日の食事は数えました。別の日の日中に、もう一度ここで食事を終えてください。"
      : "08:00以降、18:00になる前に、この工房で食事を終えてください。");
  } else if (trust < 3 || !s.region?.talked["village-guide"]?.includes(actor.id) || s.region.request?.deliveredBy !== actor.id)
    return fail("誘う本人が道の話を聞き、食事3食を届けて信用3を得る必要があります。");
  return { ...result, available: true,
    text: `${actor.name}が暮らしに誘うと、${definition.name}は同じ場所から仲間として行動を始めます。持ち物と過去の体験は共有されません。` };
}

/** One accepted joining event, with no elapsed time or random draw. */
export function recruitCompanion(s: GameState, actorId: string, npcId: string): { error?: string; resident?: Resident; text?: string } {
  const preview = getRecruitmentStatus(s, actorId, npcId);
  if (!preview.available) return { error: preview.error };
  const definition = RECRUIT_DEFINITIONS.find((entry) => entry.id === npcId)!;
  const actor = s.residents.find((person) => person.id === actorId)!;
  const present = s.residents.filter((person) => person.location === actor.location && awake(person));
  const joinedLogId = s.nextId;
  const resident: Resident = {
    id: definition.id, name: definition.name, role: definition.role, traits: [...definition.traits],
    wish: definition.wish, wishKind: definition.wishKind, routine: { ...definition.routine },
    location: actor.location, hp: 100, hunger: 80, energy: 85, mood: 65,
    skills: { ...definition.skills }, weapon: definition.weapon, armor: false, policy: "balanced",
    action: null, suspended: null, relations: {}, memories: [], wounds: { arm: 0, leg: 0, body: 0 },
    joinedAt: s.minutes, joinedLogId, sourceNpcId: definition.id,
  };
  for (const peer of s.residents) {
    const relation = peer.id === actor.id ? { closeness: 20, trust: 25 }
      : present.includes(peer) ? { closeness: 10, trust: 15 } : { closeness: 0, trust: 0 };
    peer.relations[resident.id] = { ...relation };
    resident.relations[peer.id] = { ...relation };
  }
  const inventory = ensureInventory(s);
  inventory.packs[resident.id] = { food: 0, ingredients: 0, medicine: 0, scrap: 0 };
  s.residents.push(resident);
  s.region ??= createRegionState(s);
  (s.region.recruitments ??= []).push({ residentId: resident.id, invitedBy: actor.id, time: s.minutes, logId: joinedLogId });
  const joining = definition.id === LODGE_KEEPER.id
    ? "舟宿番は綯いかけの縄をしまい、一緒に工房の食卓を片づけた。"
    : "道案内に使っていた杖を携え、近隣の集落から一緒に行動できる。";
  const text = `${actor.name}が暮らしに誘い、${resident.name}が仲間に加わった。${joining}`;
  s.logs.push({ id: s.nextId++, time: s.minutes, type: "social", title: "新しい仲間", text,
    actors: [actor.id, resident.id], witnesses: [...present.map((person) => person.id), resident.id] });
  return { resident, text };
}

/** Identity and historical membership, separate from physical/statistical validation. */
export function validRoster(s: GameState): boolean {
  if (!Array.isArray(s.residents) || s.residents.some((person) => !record(person) || typeof person.id !== "string")) return false;
  if (!whole(s.minutes) || !whole(s.nextId, 1) || !validRegion(s)) return false;
  const ids = new Set(s.residents.map((person) => person.id));
  if (s.origin !== undefined && ((s.origin !== "solo" && s.origin !== "trader") || s.version < 3)) return false;
  const founders = new Set<string>(s.origin === undefined ? FOUNDERS : ["aki"]);
  if (ids.size !== s.residents.length || [...founders].some((id) => !ids.has(id))) return false;
  const definitions = new Map(RECRUIT_DEFINITIONS.map((entry) => [entry.id as string, entry]));
  for (const person of s.residents) {
    if (founders.has(person.id)) {
      if (person.sourceNpcId !== undefined || (person.joinedAt !== undefined && person.joinedAt !== 0)
        || person.joinedLogId !== undefined) return false;
    } else if (!definitions.has(person.id) || (s.version !== 3 && s.version !== 4 && s.version !== 5)) return false;
  }
  const entries = s.region?.recruitments ?? [];
  if (!Array.isArray(entries) || entries.length !== s.residents.length - founders.size) return false;
  const memberships = new Map<string, { time: number; logId: number }>();
  const seenLogs = new Set<number>();
  for (const entry of entries) {
    if (!record(entry) || typeof entry.residentId !== "string" || !definitions.has(entry.residentId)
      || memberships.has(entry.residentId) || typeof entry.invitedBy !== "string" || entry.invitedBy === entry.residentId
      || !whole(entry.time) || entry.time > s.minutes || entry.time % 1440 < 480 || entry.time % 1440 >= 1080
      || !whole(entry.logId, 1) || entry.logId >= s.nextId
      || seenLogs.has(entry.logId)) return false;
    memberships.set(entry.residentId, { time: entry.time, logId: entry.logId });
    seenLogs.add(entry.logId);
  }
  for (const entry of entries) {
    const person = s.residents.find((resident) => resident.id === entry.residentId);
    const definition = definitions.get(entry.residentId)!;
    const inviter = s.residents.find((resident) => resident.id === entry.invitedBy);
    const inviterMembership = memberships.get(entry.invitedBy);
    if (!person || !inviter || person.sourceNpcId !== definition.id || person.joinedAt !== entry.time
      || person.joinedLogId !== entry.logId || (!founders.has(inviter.id) && (!inviterMembership
        || inviterMembership.time > entry.time || inviterMembership.logId >= entry.logId))) return false;
    const logs = Array.isArray(s.logs) ? s.logs.filter((log) => log?.id === entry.logId) : [];
    const log = logs[0];
    if (logs.length !== 1 || log.time !== entry.time || log.type !== "social" || log.title !== "新しい仲間"
      || !Array.isArray(log.actors) || log.actors.length !== 2 || !log.actors.includes(inviter.id) || !log.actors.includes(person.id)
      || !Array.isArray(log.witnesses) || !log.witnesses.includes(inviter.id) || !log.witnesses.includes(person.id)
      || new Set(log.witnesses).size !== log.witnesses.length || log.witnesses.some((id) => !ids.has(id))) return false;
    for (const witness of log.witnesses) {
      const membership = memberships.get(witness);
      if (witness !== person.id && membership && (membership.time > entry.time || membership.logId >= entry.logId)) return false;
    }
    if (definition.id === LODGE_KEEPER.id) {
      if (lodgeMealDays(s, inviter.id, entry.time, entry.logId).size < 2) return false;
    } else {
      const receipts = s.region?.receipts;
      if (!Array.isArray(receipts)) return false;
      const proof = receipts.filter((receipt) => receipt.actorId === inviter.id && receipt.npcId === definition.id
        && whole(receipt.time) && receipt.time <= entry.time);
      if (!proof.some((receipt) => receipt.choice === "talk" && receipt.trustGain === 1)
        || !proof.some((receipt) => receipt.choice === "deliver" && receipt.trustGain === 2)
        || proof.reduce((total, receipt) => total + receipt.trustGain, 0) < 3
        || !s.region?.talked["village-guide"]?.includes(inviter.id) || s.region.request?.deliveredBy !== inviter.id
        || s.region.request.time > entry.time || (s.region.trust["village-guide"]?.[inviter.id] ?? 0) < 3) return false;
    }
    for (const action of [person.action, person.suspended]) {
      if (!action) continue;
      if (!record(action) || !whole(action.id, 1) || action.id <= entry.logId) return false;
      if (action.autonomyReason !== undefined && (!record(action.autonomyReason)
        || !whole(action.autonomyReason.decidedAt) || action.autonomyReason.decidedAt < entry.time)) return false;
    }
    const leisure = s.autonomy?.leisure?.[person.id];
    if (leisure !== undefined && (!record(leisure) || !whole(leisure.startedAt) || leisure.startedAt < entry.time
      || !whole(leisure.actionId, 1) || leisure.actionId <= entry.logId)) return false;
    const stay = s.autonomy?.manualStays?.[person.id];
    if (stay !== undefined && (!record(stay) || !whole(stay.time) || stay.time < entry.time)) return false;
  }
  // A later member cannot own an earlier regional action, even if its receipts balance.
  for (const receipt of s.region?.receipts ?? []) {
    const member = memberships.get(receipt.actorId);
    if (member && receipt.time < member.time) return false;
    if (member && isCoinChoice(receipt.choice) && (!whole(receipt.logId, 1) || receipt.logId <= member.logId)) return false;
    const joinedNpc = memberships.get(receipt.npcId);
    if (joinedNpc && receipt.time > joinedNpc.time) return false;
  }
  for (const transfer of s.currency?.transfers ?? []) {
    for (const id of new Set([transfer.actorId, transfer.from, transfer.to])) {
      const member = memberships.get(id);
      if (member && (transfer.time < member.time || transfer.logId <= member.logId)) return false;
    }
  }
  for (const harvest of s.region?.harvests ?? []) {
    const member = memberships.get(harvest.actorId);
    if (member && harvest.time < member.time) return false;
  }
  const trades = s.trade?.receipts;
  if (trades !== undefined && !Array.isArray(trades)) return false;
  for (const receipt of trades ?? []) {
    if (!record(receipt)) return false;
    const member = memberships.get(receipt.actorId);
    if (member && (!whole(receipt.time) || receipt.time < member.time
      || !whole(receipt.id, 1) || receipt.id <= member.logId)) return false;
  }
  return true;
}
