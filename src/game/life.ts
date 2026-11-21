import { isKnownLocation, workSite } from "./types";
import type {
  ActionKind,
  ConversationReport,
  CraftPiece,
  EventKnowledge,
  GameState,
  LifeExperience,
  LifeExperienceKind,
  LifeState,
  LocationId,
  MorningReflection,
  Resident,
} from "./types";
import { getProjectRecipe } from "./projects";
import { isOutdoorQuiet, sceneryName } from "./scenery";
import { getCraftDisplayTitle, validCraftSubjectReference } from "./art-subject";
import { getWishKind } from "./routines";

export type {
  CraftPiece,
  ConversationReport,
  EventKnowledge,
  LifeExperience,
  LifeState,
  MorningReflection,
} from "./types";
export type LifeSuggestion = {
  kind: ActionKind;
  target?: string;
  residentIds: string[];
  label: string;
};
export type WishProgress = {
  title: string;
  completed: boolean;
  completedAt?: number;
  progress: string;
  nextAction?: LifeSuggestion;
  reason?: string;
};

const BASE = new Set<LocationId>(["home", "kitchen", "bedroom", "garden"]);
const settlingTable = (location: LocationId) => BASE.has(location) || location === "lodge";
const EXPERIENCE_LABELS: Record<LifeExperienceKind, string> = {
  craft: "木彫りができた",
  shelf: "窓辺の棚を整えた",
  display: "作品を飾った",
  "village-art-feedback": "商い手から作品の感想を聞いた",
  meal: "食事をとった",
  help: "仕事を手伝った",
  rescue: "仲間を連れて帰った",
  heal: "手当をした",
  supply: "物資を回収した",
  return: "拠点へ帰った",
  wish: "小さな望みがかなった",
  conversation: "言葉を交わした",
  project: "暮らしの道具を整えた",
  quiet: "静かな時間を過ごした",
};
export function createLifeState(): LifeState {
  return {
    version: 1,
    crafts: [],
    wishes: {},
    events: [],
    reflections: [],
    meals: [],
  };
}
export function ensureLife(state: GameState): LifeState {
  return (state.life ??= createLifeState());
}
const nameOf = (s: GameState, id: string) =>
  s.residents.find((r) => r.id === id)?.name ?? id;
const awake = (r: Resident) => r.hp > 0 && r.action?.kind !== "sleep";
// World log IDs order an invitation and a meal even when neither advances the
// clock. Adding a housemate must not rewrite an earlier shared meal.
function wasHouseholdMember(r: Resident, event: Pick<LifeExperience, "time" | "id">): boolean {
  const joinedAt = r.joinedAt ?? 0;
  return joinedAt < event.time || (joinedAt === event.time
    && (r.joinedLogId === undefined || r.joinedLogId < event.id));
}
function isHouseholdMeal(s: GameState, event: LifeExperience): boolean {
  const household = s.residents.filter((r) => wasHouseholdMember(r, event));
  return event.kind === "meal" && household.length > 1 && event.actors.length === household.length
    && household.every((r) => event.actors.includes(r.id));
}

/** Reading a journal, rendering a resident or waking up does not teach facts. */
export function getEventKnowledge(s: GameState, residentId: string, eventId: number): EventKnowledge {
  if (!s.residents.some((r) => r.id === residentId)) return { status: "unknown" };
  const source = s.life?.events.find((e) => e.id === eventId);
  if (!source) return { status: "unknown" };
  if (source.witnesses.includes(residentId)) return { status: "direct", knownAt: source.time };
  const conversation = s.life?.events.find((e) => e.kind === "conversation"
    && e.report?.sourceEventId === eventId && e.report.listenerId === residentId);
  return conversation?.report
    ? { status: "reported", knownAt: conversation.time, speakerId: conversation.report.speakerId, conversationEventId: conversation.id }
    : { status: "unknown" };
}

export function knowsLifeEvent(s: GameState, residentId: string, eventId: number): boolean {
  return getEventKnowledge(s, residentId, eventId).status !== "unknown";
}

/** Direct witnesses can tell the previously unaware subject one thing per scene. */
export function selectConversationReport(s: GameState, participantIds: string[]): ConversationReport | undefined {
  const candidates: { source: LifeExperience; speakerId: string; listenerId: string }[] = [];
  for (const source of s.life?.events ?? []) {
    const listenerId = source.subjectId;
    if (!["rescue", "heal"].includes(source.kind) || source.time >= s.minutes
      || !listenerId || !participantIds.includes(listenerId)
      || knowsLifeEvent(s, listenerId, source.id)) continue;
    for (const speakerId of participantIds) {
      if (speakerId !== listenerId && source.witnesses.includes(speakerId))
        candidates.push({ source, speakerId, listenerId });
    }
  }
  const chosen = candidates.sort((a, b) => Number(b.source.kind === "rescue") - Number(a.source.kind === "rescue")
    || b.source.time - a.source.time || b.source.id - a.source.id
    || Number(b.source.actors.includes(b.speakerId)) - Number(a.source.actors.includes(a.speakerId))
    || a.speakerId.localeCompare(b.speakerId) || a.listenerId.localeCompare(b.listenerId))[0];
  return chosen ? { sourceEventId: chosen.source.id, speakerId: chosen.speakerId, listenerId: chosen.listenerId } : undefined;
}

/** A bystander sees a conversation, without receiving its report as knowledge. */
export function getLifeExperienceText(s: GameState, event: LifeExperience, residentId: string): string {
  if (event.kind === "conversation" && event.topic?.kind === "craft" && event.actors.includes(residentId)) {
    const craft = s.life?.crafts.find((piece) => piece.id === event.topic!.craftId);
    const other = event.actors.find((id) => id !== residentId);
    if (craft && other) return residentId === craft.authorId
      ? `${nameOf(s, residentId)}は${nameOf(s, other)}に、自分の${getCraftDisplayTitle(s, craft)}を紹介し、一緒に見ながら話した。`
      : `${nameOf(s, residentId)}は${nameOf(s, craft.authorId)}に紹介された${getCraftDisplayTitle(s, craft)}を、一緒に見ながら話した。`;
  }
  const report = event.kind === "conversation" ? event.report : undefined;
  if (!report || ![report.speakerId, report.listenerId].includes(residentId)) return event.text;
  const source = s.life?.events.find((e) => e.id === report.sourceEventId);
  if (!source) return event.text;
  const actor = source.actors.map((id) => nameOf(s, id)).join("と");
  if (residentId === report.listenerId) return source.kind === "rescue"
    ? `${nameOf(s, report.listenerId)}は${nameOf(s, report.speakerId)}から、${actor}が自分を拠点へ運んだと聞いた。`
    : `${nameOf(s, report.listenerId)}は${nameOf(s, report.speakerId)}から、${actor}が自分の傷を手当したと聞いた。`;
  const subject = nameOf(s, report.listenerId);
  const who = source.actors.length === 1 && source.actors[0] === report.speakerId ? "自分" : actor;
  return source.kind === "rescue"
    ? `${nameOf(s, report.speakerId)}は${subject}に、${who}が${subject}を拠点へ運んだ時のことを話した。`
    : `${nameOf(s, report.speakerId)}は${subject}に、${who}が${subject}の傷を手当したと話した。`;
}

/** Called only by completed world actions, never by rendering or a selector. */
export function recordExperience(
  state: GameState,
  kind: LifeExperienceKind,
  actors: string[],
  options: {
    location?: LocationId;
    subjectId?: string;
    craftId?: number;
    text?: string;
    projectId?: number;
  } = {},
): LifeExperience {
  const life = ensureLife(state);
  const actorIds = [...new Set(actors)];
  const people = actorIds.map((id) => state.residents.find((r) => r.id === id)).filter((r): r is Resident => !!r);
  const location = options.location ?? people[0]?.location ?? "home";
  const event: LifeExperience = {
    id: state.nextId++,
    time: state.minutes,
    kind,
    location,
    actors: actorIds,
    witnesses: state.residents
      .filter((r) => r.location === location && awake(r))
      .map((r) => r.id),
    title: EXPERIENCE_LABELS[kind],
    text:
      options.text ??
      `${people.map((r) => r.name).join("と")}が${EXPERIENCE_LABELS[kind]}。`,
    ...(options.subjectId ? { subjectId: options.subjectId } : {}),
    ...(options.craftId !== undefined ? { craftId: options.craftId } : {}),
    ...(options.projectId !== undefined ? { projectId: options.projectId } : {}),
    ...(kind === "supply" && people[0] ? {
      health: people[0].hp,
      healthByActor: Object.fromEntries(people.map((person) => [person.id, person.hp])),
    } : {}),
  };
  life.events.push(event);
  if (kind === "supply" && location === "garden")
    for (const resident of people)
      if (getWishKind(resident) === "safe-return") completeWish(state, resident.id, event);
  return event;
}
function completeWish(s: GameState, residentId: string, event: LifeExperience) {
  const life = ensureLife(s);
  if (life.wishes[residentId]) return;
  life.wishes[residentId] = { completedAt: s.minutes, eventId: event.id };
  const resident = s.residents.find((r) => r.id === residentId);
  if (resident) resident.mood = Math.min(100, resident.mood + 8);
}
export function finishCraft(
  s: GameState,
  resident: Resident,
  actionId: number,
  design: CraftPiece["design"] = "bird",
  subjectEventId?: number,
) {
  const life = ensureLife(s);
  const craft: CraftPiece = {
    id: actionId,
    authorId: resident.id,
    createdAt: s.minutes,
    createdLocation: resident.location,
    design,
    ...(subjectEventId !== undefined ? { subjectEventId } : {}),
  };
  life.crafts.push(craft);
  recordExperience(s, "craft", [resident.id], {
    craftId: craft.id,
    text: `${resident.name}が自分の${getCraftDisplayTitle(s, craft)}を仕上げた。まだ手元にあり、飾る場所を選べる。`,
  });
  return craft;
}
export function finishShelf(s: GameState, resident: Resident) {
  ensureLife(s).shelf = {
    location: resident.location,
    creatorId: resident.id,
    time: s.minutes,
  };
  recordExperience(s, "shelf", [resident.id], {
    text: `${resident.name}がこの場所の窓辺を整え、作品を置けるようにした。`,
  });
}
export function finishPlacement(
  s: GameState,
  resident: Resident,
  craftId: number,
): CraftPiece | undefined {
  const life = ensureLife(s);
  const craft = life.crafts.find(
    (c) =>
      c.id === craftId &&
      c.authorId === resident.id &&
      c.displayedAt === undefined,
  );
  if (!craft || life.shelf?.location !== resident.location) return undefined;
  craft.displayedAt = s.minutes;
  craft.displayLocation = resident.location;
  const event = recordExperience(s, "display", [resident.id], {
    craftId: craft.id,
    text: `${resident.name}が、自分で作った${getCraftDisplayTitle(s, craft)}を窓辺へ飾った。`,
  });
  if (getWishKind(resident) === "display") completeWish(s, resident.id, event);
  return craft;
}

/** Actual completed meals only. Nearby, sleeping or merely assigned people are not diners. */
export function finishMeal(s: GameState, resident: Resident, due: Set<number>, unavailableIds: ReadonlySet<string> = new Set()): {
  participants: Resident[]; event: LifeExperience; shouldLog: boolean;
} {
  const life = ensureLife(s);
  life.meals = life.meals.filter(
    (m) => m.residentId !== resident.id && s.minutes - m.time <= 5,
  );
  life.meals.push({
    residentId: resident.id,
    time: s.minutes,
    location: resident.location,
  });
  const finishingNow = s.residents
    .filter(
      (r) =>
        r.hp > 0 &&
        r.location === resident.location &&
        r.action?.kind === "eat" &&
        due.has(r.action.id),
    )
    .map((r) => r.id);
  const ids = new Set([
    ...life.meals
      .filter((m) => m.location === resident.location)
      .map((m) => m.residentId),
    ...finishingNow,
  ]);
  const diners = s.residents.filter((r) => !unavailableIds.has(r.id) && ids.has(r.id) && r.location === resident.location && awake(r));
  const existing = life.events.find(
        (e) =>
          e.kind === "meal" &&
          e.time === s.minutes &&
          e.location === resident.location &&
          e.actors.length === diners.length && diners.every((r) => e.actors.includes(r.id)),
      );
  const event =
    existing ??
    recordExperience(
      s,
      "meal",
      diners.map((r) => r.id),
      {
        location: resident.location,
        text: diners.length > 1
          ? `${diners.map((r) => r.name).join("と")}が、同じ場所で${BASE.has(resident.location) ? "温かい食事を囲んだ" : "食事をとった"}。`
          : `${resident.name}が食事をとった。`,
      },
    );
  if (event.location === "lodge") {
    const finishers = event.lodgeMealFinishers ??= [];
    if (!finishers.includes(resident.id)) finishers.push(resident.id);
  }
  // The original wish is a warm meal at home; a travelling meal does not
  // establish a table, warmth, or a completed homecoming by its prose alone.
  if (settlingTable(resident.location)) {
    for (const diner of diners) {
      const kind = getWishKind(diner);
      if ((kind === "household-meal" && BASE.has(resident.location) && isHouseholdMeal(s, event))
        || (kind === "settle" && event.actors.length >= 2 && wasHouseholdMember(diner, event)))
        completeWish(s, diner.id, event);
    }
  }
  return { participants: diners, event, shouldLog: !existing };
}

export function finishReturn(s: GameState, resident: Resident) {
  const life = ensureLife(s);
  const event = recordExperience(s, "return", [resident.id], {
    text: `${resident.name}が拠点へ帰り着いた。今日の外出を終え、暮らしへ戻れる。`,
  });
  if (getWishKind(resident) !== "safe-return" || life.wishes[resident.id]) return;
  const supply = [...life.events]
    .reverse()
    .find(
      (e) =>
        e.kind === "supply" &&
        e.location === "shelter" &&
        e.actors.includes(resident.id) &&
        e.time <= event.time,
    );
  const collectedHealth = supply?.healthByActor
    ? supply.healthByActor[resident.id]
    : supply?.actors[0] === resident.id ? supply.health : undefined;
  if (
    supply &&
    collectedHealth !== undefined &&
    resident.hp > 35 &&
    resident.hp >= collectedHealth
  )
    completeWish(s, resident.id, event);
}

function reflectionText(
  s: GameState,
  r: Resident,
  event: LifeExperience,
): string {
  const craft = event.craftId === undefined ? undefined : s.life?.crafts.find((piece) => piece.id === event.craftId);
  const craftTitle = craft ? getCraftDisplayTitle(s, craft) : "木彫り";
  if (event.kind === "village-art-feedback") return event.text;
  if (event.kind === "display" && event.location === "village")
    return `昨日、${nameOf(s, event.actors[0])}の${craftTitle}が集落の店先に並んだ。`;
  if (event.kind === "display")
    return event.actors.includes(r.id)
      ? `昨日、自分の手で作った${craftTitle}を窓辺に置いた。今日もここで暮らしていけそうだ。`
      : `昨日、${nameOf(s, event.actors[0])}が飾った${craftTitle}を見た。今日は作品の話をしてみたい。`;
  if (event.kind === "craft")
    return event.actors.includes(r.id)
      ? `昨日仕上げた${craftTitle}が手元にある。飾る場所を整えたい。`
      : `昨日、${nameOf(s, event.actors[0])}が${craftTitle}を仕上げた。できあがりを見せてもらいたい。`;
  if (event.kind === "project") return event.actors.includes(r.id)
    ? "昨日、暮らしを支えるものを自分の手で整えた。今日は使い心地を確かめたい。"
    : `昨日、${nameOf(s, event.actors[0])}が暮らしの道具を整えるところを見た。今日は使ってみたい。`;
  if (event.kind === "quiet") {
    if (isOutdoorQuiet(event)) {
      const place = sceneryName(event.location);
      const others = event.actors.filter((id) => id !== r.id).map((id) => nameOf(s, id)).join("と");
      return event.actors.includes(r.id)
        ? `昨日は${others ? `${others}と` : ""}${place}で景色を眺めた。今日はどこで過ごそうか。`
        : `昨日、${event.actors.map((id) => nameOf(s, id)).join("と")}が${place}で景色を眺めるところを見た。今日は自分の過ごし方も選べる。`;
    }
    return event.actors.includes(r.id)
      ? "昨日は静かな場所でひと息つけた。今日も、自分のペースを大切にしたい。"
      : `昨日、${nameOf(s, event.actors[0])}が静かに休むところを見た。今日はそれぞれの時間も大切にしたい。`;
  }
  if (event.kind === "meal") {
    const atHome = BASE.has(event.location);
    if (event.actors.includes(r.id)) {
      if (isHouseholdMeal(s, event)) {
        const group = event.actors.length === 3 ? "三人" : "皆";
        if (!atHome) {
          if (r.id === "aki") return `昨日は${group}で出先の食事をとった。今日は、出かける準備も一緒の時間も選びたい。`;
          if (r.id === "mio") return `昨日は${group}で出先の食事をとれた。今日も皆の体調を見て過ごしたい。`;
          return `昨日は${group}で出先の食事をとった。今日は持ち物と帰り道も確かめたい。`;
        }
        if (r.id === "aki") return `昨日は${group}で食卓を囲んだ。今日は、自分の時間も一緒の時間も作りたい。`;
        if (r.id === "mio") return `昨日は${group}で温かい食事を囲めた。今日も顔を合わせる時間があると嬉しい。`;
        return `昨日は${group}で食事をとった。今日は無理のない予定を考えたい。`;
      }
      if (event.actors.length >= 2)
        return atHome
          ? "昨日は仲間と食卓を囲んだ。今日も、顔を合わせる時間を作れたらいい。"
          : "昨日は仲間と出先で食事をとった。今日も、持ち物と体調を見て過ごしたい。";
      return "昨日は食事をとり、ひと息つけた。今日はどんな時間を過ごそうか。";
    }
    return event.actors.length === 1
      ? `昨日、${nameOf(s, event.actors[0])}が食事をとるところを見た。今日も皆の様子を気にかけたい。`
      : atHome
        ? "昨日、仲間たちが食卓を囲むところを見た。今日は自分も一緒に過ごす時間を選べる。"
        : "昨日、仲間たちが出先で食事をとるところを見た。今日は自分も一緒に過ごす時間を選べる。";
  }
  if (event.kind === "help")
    return event.actors.includes(r.id)
      ? `昨日は${nameOf(s, event.subjectId ?? event.actors[0])}と手を動かした。一人ではないと思えた。`
      : event.subjectId === r.id
        ? "昨日、仕事を手伝ってもらった。一人ではないと思えた。"
        : "昨日、仲間が仕事を手伝うところを見た。自分にもできることがありそうだ。";
  if (event.kind === "rescue")
    return event.actors.includes(r.id)
      ? `昨日、${nameOf(s, event.subjectId ?? "")}を連れて帰った。今日は自分の休息も大事にしたい。`
      : event.subjectId === r.id
        ? "昨日、仲間に運ばれて拠点へ戻った。今日は自分の体調を確かめてから過ごしたい。"
        : "昨日、仲間が拠点へ運び込まれた。今日は体調を確かめてから過ごしたい。";
  if (event.kind === "heal")
    return event.subjectId === r.id
      ? "昨日、傷の手当を受けた。無理をせず、できることから戻していきたい。"
      : event.actors.includes(r.id)
        ? "昨日は傷の手当をした。今日は皆の様子を確かめたい。"
        : "昨日、仲間が手当を受けるところを見た。今日は体調を気にかけたい。";
  if (event.kind === "return")
    return event.actors.includes(r.id)
      ? "昨日は家へ帰ってこられた。今日は物資と体調を見て、出かけるかを決めたい。"
      : `昨日、${nameOf(s, event.actors[0])}が拠点へ帰ってきた。今日はそれぞれの体調と予定を確かめたい。`;
  if (event.kind === "supply")
    return event.actors.includes(r.id)
      ? "昨日見つけた物資が、今日の暮らしを少し支えてくれる。"
      : `昨日、${nameOf(s, event.actors[0])}が物資を見つけた。使い道を一緒に考えたい。`;
  if (event.kind === "shelf")
    return event.actors.includes(r.id)
      ? "昨日整えた窓辺がある。今日はそこへ何を置こうか。"
      : `昨日、${nameOf(s, event.actors[0])}が窓辺を整えるところを見た。今日はそこへ何が置かれるだろう。`;
  if (event.kind === "conversation") {
    if (event.topic?.kind === "craft" && event.actors.includes(r.id)) {
      const shared = s.life?.crafts.find((piece) => piece.id === event.topic!.craftId);
      const other = event.actors.find((id) => id !== r.id);
      if (shared && other) return `昨日、${nameOf(s, other)}と${getCraftDisplayTitle(s, shared)}を見ながら話した。今日も自分の過ごし方を選べる。`;
    }
    if (event.report?.listenerId === r.id) {
      const source = s.life?.events.find((e) => e.id === event.report!.sourceEventId);
      if (source) {
        const actor = source.actors.map((id) => nameOf(s, id)).join("と");
        return source.kind === "rescue"
          ? `昨日、${nameOf(s, event.report.speakerId)}から、${actor}が自分を拠点へ運んだと聞いた。今日は体調を確かめて過ごしたい。`
          : `昨日、${nameOf(s, event.report.speakerId)}から、${actor}が自分の傷を手当したと聞いた。今日はできることから過ごしたい。`;
      }
    }
    return event.actors.includes(r.id)
      ? "昨日、仲間と言葉を交わした。今日もそれぞれの時間を大切にしたい。"
      : "昨日、仲間たちが言葉を交わすところを見た。今日は自分も話す時間を選べる。";
  }
  if (event.kind === "wish")
    return event.actors.includes(r.id)
      ? "昨日、小さな望みに一区切りがついた。今日はまた、自分の過ごし方を選べる。"
      : "昨日、仲間の小さな望みがかなうところを見た。今日は自分の過ごし方も選べる。";
  return `昨日、${event.title}という出来事を見た。今日はそれぞれの様子を確かめたい。`;
}
export function makeMorningReflections(s: GameState): MorningReflection[] {
  const life = ensureLife(s);
  const day = Math.floor(s.minutes / 1440) + 1;
  const added: MorningReflection[] = [];
  const weight: Record<LifeExperienceKind, number> = {
    display: 9,
    "village-art-feedback": 8,
    rescue: 8,
    heal: 7,
    help: 6,
    craft: 5,
    return: 4,
    supply: 3,
    shelf: 3,
    meal: 2,
    wish: 1,
    conversation: 1,
    project: 6,
    quiet: 3,
  };
  for (const resident of s.residents) {
    if (
      !awake(resident) ||
      life.reflections.some(
        (r) => r.residentId === resident.id && r.day === day,
      )
    )
      continue;
    const score = (event: LifeExperience) =>
      weight[event.kind] +
      (event.actors.includes(resident.id) ? 3 : 0) +
      (isOutdoorQuiet(event) && event.actors.includes(resident.id) ? 5 : 0) +
      (isHouseholdMeal(s, event) ? 5 : 0) +
      (life.wishes[resident.id]?.eventId === event.id ? 6 : 0) +
      (event.kind === "conversation" && event.report?.listenerId === resident.id ? 15 : 0) +
      (event.kind === "rescue" &&
      (event.actors.includes(resident.id) || event.subjectId === resident.id)
        ? 9
        : 0);
    const event = life.events
      .filter(
        (e) =>
          e.time >= s.minutes - 1440 &&
          e.time < s.minutes &&
          e.witnesses.includes(resident.id),
      )
      .sort((a, b) => score(b) - score(a) || b.time - a.time || b.id - a.id)[0];
    if (!event) continue;
    const sameDate =
      Math.floor(event.time / 1440) === Math.floor(s.minutes / 1440);
    const text = reflectionText(s, resident, event).replace(
      /^昨日/,
      sameDate ? "今朝までに" : "昨日",
    );
    const reflection: MorningReflection = {
      residentId: resident.id,
      day,
      time: s.minutes,
      eventId: event.id,
      text,
    };
    life.reflections.push(reflection);
    added.push(reflection);
  }
  return added;
}

function conversationPossible(a: Resident, b: Resident) {
  return (
    a.id !== b.id &&
    a.location === b.location &&
    BASE.has(a.location) &&
    awake(a) &&
    awake(b) &&
    ![a.action?.kind, b.action?.kind].some(
      (k) => k && ["move", "rescue", "attack"].includes(k),
    )
  );
}
function suggestion(
  s: GameState,
  kind: ActionKind,
  ids: string[],
  label: string,
  target?: string,
): LifeSuggestion {
  return { kind, residentIds: ids, label, ...(target ? { target } : {}) };
}
export function getWishProgress(
  s: GameState,
  residentId: string,
): WishProgress {
  const r = s.residents.find((p) => p.id === residentId);
  if (!r)
    return { title: "", completed: false, progress: "住民が見つかりません。" };
  const done = s.life?.wishes[residentId];
  const result: WishProgress = {
    title: r.wish,
    completed: !!done,
    ...(done ? { completedAt: done.completedAt } : {}),
    progress: done
      ? "この望みはかなった。今日の過ごし方は、これからも選べる。"
      : "まだ途中。急いでかなえる必要はない。",
  };
  if (done) return result;
  if (!awake(r))
    return {
      ...result,
      reason: "意識が戻り、休める状態になってから考えよう。",
    };
  const wishKind = getWishKind(r);
  if (wishKind === "display") {
    const own =
      s.life?.crafts.filter(
        (c) => c.authorId === residentId && c.displayedAt === undefined,
      ) ?? [];
    const shelf = s.life?.shelf;
    if (!own.length)
      return {
        ...result,
        progress: "まずは自分の木彫りを一つ仕上げたい。",
        ...(BASE.has(r.location) || r.location === "lodge"
          ? { nextAction: suggestion(s, "hobby", [residentId], "木彫りを作る") }
          : { reason: "木彫りは拠点か舟宿の工房で作れる。" }),
      };
    if (!shelf)
      return {
        ...result,
        progress: "作品はできた。次は飾る窓辺を整えたい。",
        ...(BASE.has(r.location)
          ? {
              nextAction: suggestion(
                s,
                "decorate",
                [residentId],
                s.flags.decorated ? "棚をここへ整える" : "窓辺を整える",
              ),
            }
          : { reason: "窓辺は拠点で整えられる。" }),
      };
    if (r.location !== shelf.location)
      return {
        ...result,
        progress: "作品を持って、棚のある場所へ行こう。",
        nextAction: suggestion(
          s,
          "move",
          [residentId],
          "棚のある場所へ",
          shelf.location,
        ),
      };
    return {
      ...result,
      progress: "自分の作品を、窓辺に飾れる。",
      nextAction: suggestion(
        s,
        "place-craft",
        [residentId],
        "作品を飾る",
        String(own[0].id),
      ),
    };
  }
  if (wishKind === "household-meal") {
    const group = s.residents.length === 3 ? "三人" : "皆";
    const ready = s.residents.every(
      (p) => BASE.has(p.location) && p.location === r.location && awake(p),
    );
    return {
      ...result,
      progress: `${group}が拠点の同じ場所で、実際に食事をとるとかなう。`,
      ...(ready
        ? {
            nextAction: suggestion(
              s,
              "eat",
              s.residents.map((p) => p.id),
              `${group}で食事をとる`,
            ),
          }
        : s.residents.every((p) => awake(p)) ? {
            reason: `${group}を共同の居間へ集めてから、食事を選べる。`,
            nextAction: suggestion(s, "move", s.residents.map((p) => p.id), "食卓へ集まる", "home"),
          } : { reason: `${group}が起きて、同じ場所で過ごせる時に食事を囲もう。` }),
    };
  }
  if (wishKind === "settle") {
    const peer = s.residents.find((p) => p.id !== r.id && awake(p) && p.location === r.location)
      ?? s.residents.find((p) => p.id !== r.id && awake(p));
    const ready = peer && settlingTable(r.location) && peer.location === r.location;
    return {
      ...result,
      progress: r.location === "lodge"
        ? "舟宿の食卓を仲間と囲んで、ここでの暮らしを始めたい。"
        : "拠点で仲間と実際に食事をとり、ここでの暮らしを始めたい。",
      ...(ready ? {
        nextAction: suggestion(s, "eat", [r.id, peer.id], "仲間と食事をとる"),
      } : peer ? {
        reason: r.location === "lodge" ? "仲間を舟宿の工房に迎えて、食事を囲もう。" : "仲間と共同の居間へ集まってから、食事を囲もう。",
        nextAction: r.location === "lodge"
          ? suggestion(s, "move", [peer.id], "舟宿の食卓へ", "lodge")
          : suggestion(s, "move", [r.id, peer.id], "食卓へ集まる", "home"),
      } : { reason: "仲間が起きて、一緒に過ごせる時に食事を囲もう。" }),
    };
  }
  const found = s.life?.events.some(
    (e) =>
      e.kind === "supply" &&
      e.location === "shelter" &&
      e.actors.includes(residentId),
  );
  if (found && !BASE.has(r.location))
    return {
      ...result,
      progress: "自分で見つけた物資を、無事に持ち帰ろう。",
      nextAction: suggestion(s, "move", [residentId], "拠点へ帰る", "home"),
    };
  if (r.location === "shelter" && !s.flags.safeSuppliesRecovered)
    return {
      ...result,
      progress: "木陰の物資を、自分の手で回収できる。",
      nextAction: suggestion(s, "gather", [residentId], "木陰の物資を集める"),
    };
  if (s.flags.safeSuppliesRecovered)
    return {
      ...result,
      progress: "迂回路は回収済み。裏庭で明日の食材を集めることもできる。",
      nextAction:
        r.location === "garden"
          ? suggestion(s, "gather", [residentId], "裏庭で食材を集める")
          : suggestion(s, "move", [residentId], "裏庭へ向かう", "garden"),
    };
  return {
    ...result,
    progress: "木陰の迂回路で物資を回収し、無事に拠点へ帰りたい。",
    nextAction: suggestion(
      s,
      "move",
      [residentId],
      "木陰の迂回路へ",
      "shelter",
    ),
  };
}
export function getResidentLife(
  s: GameState,
  residentId: string,
): {
  wish: WishProgress;
  crafts: CraftPiece[];
  reflection?: MorningReflection;
  recentExperiences: LifeExperience[];
  suggestion?: LifeSuggestion;
} {
  const resident = s.residents.find((r) => r.id === residentId);
  const day = Math.floor(s.minutes / 1440) + 1;
  const reflection = s.life?.reflections.find(
    (r) => r.residentId === residentId && r.day === day,
  );
  const recentExperiences = (s.life?.events ?? [])
    .filter((e) => e.witnesses.includes(residentId))
    .slice(-4)
    .reverse()
    .map((e) => e.report || e.topic ? { ...e, text: getLifeExperienceText(s, e, residentId) } : e);
  const event = reflection
    ? s.life?.events.find((e) => e.id === reflection.eventId)
    : undefined;
  const peerId =
    event &&
    [
      ...event.actors,
      ...(event.subjectId ? [event.subjectId] : []),
      ...event.witnesses,
    ].find((id) => id !== residentId);
  const peer = peerId ? s.residents.find((r) => r.id === peerId) : undefined;
  const candidate =
    resident && peer && conversationPossible(resident, peer)
      ? suggestion(
          s,
          "socialize",
          [residentId, peer.id],
          ["craft", "display"].includes(event!.kind)
            ? "作品の話をする"
            : Math.floor(event!.time / 1440) === Math.floor(s.minutes / 1440)
              ? "今朝までのことを話す"
              : "昨日のことを話す",
          peer.id,
        )
      : undefined;
  return {
    wish: getWishProgress(s, residentId),
    crafts: (s.life?.crafts ?? []).filter((c) => c.authorId === residentId),
    ...(reflection ? { reflection } : {}),
    recentExperiences,
    ...(candidate ? { suggestion: candidate } : {}),
  };
}

/** Validate optional extension without migrating facts that an old save never recorded. */
export function validLifeState(s: GameState): boolean {
  if (s.life === undefined) return true;
  const object = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === "object" && !Array.isArray(v);
  const integer = (v: unknown, min = 0, max = s.minutes): v is number =>
    typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max;
  const location = isKnownLocation;
  const ids = new Set(s.residents.map((r) => r.id));
  const people = (v: unknown): v is string[] =>
    Array.isArray(v) &&
    v.every((id) => typeof id === "string" && ids.has(id)) &&
    new Set(v).size === v.length;
  const life = s.life;
  if (
    !object(life) ||
    life.version !== 1 ||
    !Array.isArray(life.crafts) ||
    !Array.isArray(life.events) ||
    !Array.isArray(life.reflections) ||
    !Array.isArray(life.meals) ||
    (life.upgrades !== undefined && !Array.isArray(life.upgrades)) ||
    !object(life.wishes)
  )
    return false;
  if (
    life.shelf !== undefined &&
    (!object(life.shelf) ||
      !location(life.shelf.location) ||
      !BASE.has(life.shelf.location) ||
      !ids.has(life.shelf.creatorId) ||
      !integer(life.shelf.time))
  )
    return false;
  const used = new Set(s.logs.map((e) => e.id));
  for (const r of s.residents)
    for (const a of [r.action, r.suspended]) if (a) used.add(a.id);
  const upgradeIds = new Set<number>();
  const upgradeRecipes = new Set<string>();
  for (const upgrade of life.upgrades ?? []) {
    if (!object(upgrade) || !integer(upgrade.id, 1, s.nextId - 1) || used.has(upgrade.id)
      || !["kitchen-tools", "rest-corner", "crafting-tools"].includes(upgrade.recipeId)
      || !ids.has(upgrade.creatorId) || !location(upgrade.location) || !integer(upgrade.completedAt)
      || (!BASE.has(upgrade.location) && !(upgrade.location === "lodge" && upgrade.recipeId === "crafting-tools"))) return false;
    const key = workSite(upgrade.location) + "/" + upgrade.recipeId;
    if (upgradeRecipes.has(key)) return false;
    used.add(upgrade.id); upgradeIds.add(upgrade.id); upgradeRecipes.add(key);
  }
  const craftIds = new Set<number>();
  for (const c of life.crafts) {
    if (
      !object(c) ||
      !integer(c.id, 1, s.nextId - 1) ||
      craftIds.has(c.id) ||
      used.has(c.id) ||
      !ids.has(c.authorId) ||
      !integer(c.createdAt) ||
      !location(c.createdLocation) ||
      (!BASE.has(c.createdLocation) && c.createdLocation !== "lodge") ||
      (c.design !== undefined && !["bird", "flower"].includes(c.design))
    )
      return false;
    craftIds.add(c.id);
    used.add(c.id);
    if ((c.displayedAt === undefined) !== (c.displayLocation === undefined))
      return false;
    if (
      c.displayedAt !== undefined &&
      (!integer(c.displayedAt, c.createdAt) ||
        !location(c.displayLocation) ||
        (c.displayLocation !== "village" &&
          (c.displayLocation !== life.shelf?.location || c.displayedAt < (life.shelf?.time ?? Infinity))))
    )
      return false;
  }
  const eventIds = new Set<number>();
  for (const e of life.events) {
    if (
      !object(e) ||
      !integer(e.id, 1, s.nextId - 1) ||
      used.has(e.id) ||
      !integer(e.time) ||
      !location(e.location) ||
      !people(e.actors) ||
      e.actors.length === 0 ||
      !people(e.witnesses) ||
      typeof e.title !== "string" ||
      typeof e.text !== "string" ||
      !Object.hasOwn(EXPERIENCE_LABELS, e.kind) ||
      (e.subjectId !== undefined && !ids.has(e.subjectId)) ||
      (e.craftId !== undefined && !craftIds.has(e.craftId)) ||
      (e.projectId !== undefined && !upgradeIds.has(e.projectId)) ||
      (e.health !== undefined &&
        (typeof e.health !== "number" ||
          !Number.isFinite(e.health) ||
          e.health < 0 ||
          e.health > 100))
    )
      return false;
    if ([...e.actors, ...e.witnesses, ...(e.subjectId ? [e.subjectId] : [])]
      .some((id) => !wasHouseholdMember(s.residents.find((resident) => resident.id === id)!, e)))
      return false;
    if (e.kind === "meal" && e.location === "lodge") {
      if (!people(e.lodgeMealFinishers) || !e.lodgeMealFinishers.length
        || e.lodgeMealFinishers.some(id => !e.actors.includes(id) || !e.witnesses.includes(id))) return false;
    } else if (e.lodgeMealFinishers !== undefined) return false;
    eventIds.add(e.id);
    used.add(e.id);
    if (["craft", "display"].includes(e.kind) && e.craftId === undefined)
      return false;
    if (e.topic !== undefined) {
      const topic = e.topic;
      if (!object(topic) || Object.keys(topic).length !== 2
        || Object.keys(topic).some((key) => !["kind", "craftId"].includes(key))
        || topic.kind !== "craft" || !integer(topic.craftId, 1, s.nextId - 1)
        || e.kind !== "conversation" || e.report !== undefined || e.craftId !== undefined
        || !BASE.has(e.location) || e.actors.length !== 2
        || e.actors.some((id) => !e.witnesses.includes(id))) return false;
      const shared = life.crafts.find((piece) => piece.id === topic.craftId);
      if (!shared || !e.actors.includes(shared.authorId)
        || shared.id >= e.id || shared.createdAt > e.time
        || (shared.displayedAt !== undefined && shared.displayedAt <= e.time
          && shared.displayLocation !== e.location)) return false;
    }
    if (e.kind === "project" && e.projectId === undefined) return false;
    if (e.healthByActor !== undefined) {
      if (e.kind !== "supply" || !object(e.healthByActor)
        || Object.keys(e.healthByActor).length !== e.actors.length
        || Object.keys(e.healthByActor).some((id) => !e.actors.includes(id))
        || e.actors.some((id) => typeof e.healthByActor![id] !== "number"
          || !Number.isFinite(e.healthByActor![id]) || e.healthByActor![id] < 0 || e.healthByActor![id] > 100)
        || (e.health !== undefined && e.health !== e.healthByActor[e.actors[0]])) return false;
    }
  }
  const reported = new Set<string>();
  for (const conversation of life.events) {
    if (conversation.report === undefined) continue;
    const report = conversation.report;
    if (conversation.kind !== "conversation" || !object(report)
      || Object.keys(report).some((key) => !["sourceEventId", "speakerId", "listenerId"].includes(key))
      || !integer(report.sourceEventId, 1, s.nextId - 1)
      || !ids.has(report.speakerId) || !ids.has(report.listenerId)
      || report.speakerId === report.listenerId
      || !conversation.actors.includes(report.speakerId) || !conversation.actors.includes(report.listenerId)
      || !conversation.witnesses.includes(report.speakerId) || !conversation.witnesses.includes(report.listenerId)) return false;
    const source = life.events.find((event) => event.id === report.sourceEventId);
    const key = `${report.sourceEventId}:${report.listenerId}`;
    if (!source || !["rescue", "heal"].includes(source.kind)
      || source.subjectId !== report.listenerId
      || source.time >= conversation.time || source.id >= conversation.id
      || !source.witnesses.includes(report.speakerId) || source.witnesses.includes(report.listenerId)
      || reported.has(key)) return false;
    reported.add(key);
  }
  for (const upgrade of life.upgrades ?? []) {
    if (!life.events.some((event) => event.kind === "project" && event.projectId === upgrade.id
      && event.time === upgrade.completedAt && event.location === upgrade.location
      && event.actors.includes(upgrade.creatorId))) return false;
  }
  for (const c of life.crafts) {
    if (c.subjectEventId !== undefined && !validCraftSubjectReference(
      s, c.authorId, c.subjectEventId, c.id, c.createdAt,
    )) return false;
    if (
      !life.events.some(
        (e) =>
          e.kind === "craft" &&
          e.craftId === c.id &&
          e.time === c.createdAt &&
          e.location === c.createdLocation &&
          e.actors.includes(c.authorId),
      )
    )
      return false;
    if (
      c.displayedAt !== undefined &&
      !life.events.some(
        (e) =>
          e.kind === "display" &&
          e.craftId === c.id &&
          e.time === c.displayedAt &&
          e.location === c.displayLocation &&
          e.actors.includes(c.authorId),
      )
    )
      return false;
  }
  for (const [id, wish] of Object.entries(life.wishes)) {
    if (
      !ids.has(id) ||
      !object(wish) ||
      !integer(wish.completedAt) ||
      !integer(wish.eventId, 1, s.nextId - 1) ||
      !eventIds.has(wish.eventId)
    )
      return false;
    const event = life.events.find((e) => e.id === wish.eventId)!;
    const kind = getWishKind(s.residents.find((resident) => resident.id === id)!);
    if (
      wish.completedAt !== event.time ||
      !event.actors.includes(id) ||
      (kind === "display" && (event.kind !== "display" || !BASE.has(event.location))) ||
      (kind === "household-meal" && (!isHouseholdMeal(s, event) || !BASE.has(event.location))) ||
      (kind === "settle" && (event.kind !== "meal" || event.actors.length < 2 || !settlingTable(event.location))) ||
      (kind === "safe-return" &&
        event.kind !== "return" &&
        !(event.kind === "supply" && event.location === "garden"))
    )
      return false;
  }
  const reflected = new Set<string>();
  for (const r of life.reflections) {
    if (
      !object(r) ||
      !ids.has(r.residentId) ||
      !integer(r.day, 2, Math.floor(s.minutes / 1440) + 1) ||
      !integer(r.time) ||
      r.time % 1440 !== 480 ||
      Math.floor(r.time / 1440) + 1 !== r.day ||
      !integer(r.eventId, 1, s.nextId - 1) ||
      !eventIds.has(r.eventId) ||
      typeof r.text !== "string" ||
      reflected.has(`${r.residentId}:${r.day}`)
    )
      return false;
    const event = life.events.find((e) => e.id === r.eventId)!;
    if (
      !event.witnesses.includes(r.residentId) ||
      event.time >= r.time ||
      event.time < r.time - 1440
    )
      return false;
    reflected.add(`${r.residentId}:${r.day}`);
  }
  const diners = new Set<string>();
  for (const m of life.meals) {
    if (
      !object(m) ||
      !ids.has(m.residentId) ||
      diners.has(m.residentId) ||
      !integer(m.time) ||
      !location(m.location) ||
      !life.events.some(
        (e) =>
          e.kind === "meal" &&
          e.time === m.time &&
          e.location === m.location &&
          e.actors.includes(m.residentId),
      )
    )
      return false;
    diners.add(m.residentId);
  }
  return true;
}
