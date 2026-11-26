import type { Actor, Game, Task } from "../sim";
import { sameSpatialPoint } from "../spatial/route";
import { planHousing, rebuildHousingGeometry } from "./bridge";
import { reconcileRoomInvitations } from "./gatheringProgress";
import { housingPoint, housingRoomId } from "./topology";
import type { RoomLodging } from "./types";

type LodgingResult = { game: Game; error?: string; minutes?: number };
const person = (g: Game, id: string) =>
  g.actors.find((a) => a.person.id === id);

export function offerLodging(
  game: Game,
  providerId: string,
  residentId: string,
  roomId: string,
): LodgingResult {
  const h = game.housing;
  if (!h) return { game, error: "先に住居の移動を有効にしてください。" };
  if (h.lodging) return { game, error: "先の申し出か入居を終えてください。" };
  if (
    !game.house.rooms.some((r) => r.id === roomId) ||
    roomId === "living" ||
    roomId === "yard"
  )
    return { game, error: "共用玄関・裏庭以外の居室を選んでください。" };
  const provider = person(game, providerId);
  if (!provider || providerId === residentId || !person(game, residentId))
    return {
      game,
      error: "部屋を提供する人と入居する人に別々の同居人を選んでください。",
    };
  if (
    provider.location !== game.home ||
    provider.danger ||
    provider.injury >= 70 ||
    h.unlocated[providerId]?.reason === "regional-travel"
  )
    return {
      game,
      error: "自宅にいて安全に申し出られる提供者を選んでください。",
    };
  const allowed = h.controls.roomAccess[roomId];
  if (allowed !== null && !allowed.includes(providerId))
    return { game, error: "普段からこの部屋を利用できる住人が提供できます。" };
  const next = structuredClone(game);
  next.housing!.lodging = {
    version: 1,
    providerId,
    residentId,
    roomId,
    phase: "offered",
    returnTo: "entrance",
  };
  return { game: next };
}

function clearOffer(game: Game): LodgingResult {
  const next = structuredClone(game);
  delete next.housing!.lodging;
  return { game: next };
}

export function withdrawLodgingOffer(
  game: Game,
  providerId: string,
): LodgingResult {
  const l = game.housing?.lodging;
  if (l?.phase !== "offered" || l.providerId !== providerId)
    return {
      game,
      error: "返答前の申し出だけを、提供者本人が取り下げられます。",
    };
  return clearOffer(game);
}
export function declineLodging(game: Game, residentId: string): LodgingResult {
  const l = game.housing?.lodging;
  if (l?.phase !== "offered" || l.residentId !== residentId)
    return { game, error: "申し出を受けた本人が辞退できます。" };
  return clearOffer(game);
}

// Called on a detached action candidate or after the regional trip has fully settled.
function walk(
  game: Game,
  actor: Actor,
  roomId: string,
  label: string,
  mode: Task["mode"],
) {
  const task: Task = {
    kind: "home-move",
    target: JSON.stringify({ roomId, cell: 0 }),
    from: game.home,
    label,
    mode,
    metric: "travel",
    reserved: {},
    total: 1,
    remaining: 1,
  };
  const proposal = planHousing(game, actor, task);
  if (typeof proposal === "string") return { error: proposal };
  game.housing!.state = proposal.state;
  actor.task = proposal.task;
  actor.reason = label + "。";
  return { minutes: proposal.minutes };
}

function refreshLodgingAccess(game: Game, roomId: string) {
  rebuildHousingGeometry(game, game.housing!);
  reconcileRoomInvitations(game, roomId);
}

function changeOccupancy(
  game: Game,
  residentId: string,
  arriving: boolean,
): LodgingResult {
  const h = game.housing,
    l = h?.lodging;
  if (
    !h ||
    !l ||
    l.residentId !== residentId ||
    l.phase !== (arriving ? "offered" : "occupied")
  )
    return {
      game,
      error: arriving
        ? "申し出を受けた本人が承諾できます。"
        : "入居している本人が退居を選べます。",
    };
  const actor = person(game, residentId)!;
  if (actor.task || actor.danger || actor.injury >= 70)
    return {
      game,
      error: "予定を終え、安全に行動できるときに選んでください。",
    };
  if (arriving && actor.location !== game.home)
    return { game, error: "自宅へ戻ってから入居できます。" };
  const pos = h.state.actors[residentId]?.position;
  if (actor.location === game.home && pos?.kind !== "at")
    return { game, error: "自宅で本人の現在地を確かめてから選んでください。" };
  const next = structuredClone(game),
    housing = next.housing!,
    stay = housing.lodging!;
  // A resident outside the room can give it up in place, including while away.
  if (
    !arriving &&
    (pos?.kind !== "at" || housingRoomId(pos.point.domainId) !== l.roomId)
  ) {
    delete housing.lodging;
    refreshLodgingAccess(next, stay.roomId);
    return { game: next, minutes: 0 };
  }
  const destination = arriving ? l.roomId : "living";
  const worker = person(next, residentId)!;
  if (
    arriving &&
    pos?.kind === "at" &&
    sameSpatialPoint(pos.point, housingPoint(destination, 0))
  ) {
    stay.phase = "occupied";
    worker.reason = "居室の入口で入居を始めました。";
    refreshLodgingAccess(next, stay.roomId);
    return { game: next, minutes: 0 };
  }
  stay.phase = arriving ? "arriving" : "leaving";
  refreshLodgingAccess(next, stay.roomId);
  const result = walk(
    next,
    worker,
    destination,
    arriving ? "入居する部屋へ向かう" : "退居のため共用玄関へ向かう",
    "direct",
  );
  if (result.error) return { game, error: result.error };
  stay.orderId = worker.task!.spatial!.orderId;
  return { game: next, minutes: result.minutes };
}

export function acceptLodging(game: Game, residentId: string) {
  return changeOccupancy(game, residentId, true);
}
export function endLodging(game: Game, residentId: string) {
  return changeOccupancy(game, residentId, false);
}

export function setLodgingReturn(
  game: Game,
  residentId: string,
  returnTo: RoomLodging["returnTo"],
): LodgingResult {
  const l = game.housing?.lodging;
  if (
    l?.phase !== "occupied" ||
    l.residentId !== residentId ||
    !["room", "entrance"].includes(returnTo)
  )
    return { game, error: "入居している本人が帰宅後の過ごし方を選べます。" };
  if (returnTo === l.returnTo) return { game };
  const next = structuredClone(game);
  next.housing!.lodging!.returnTo = returnTo;
  return { game: next };
}

/** A cancelled transit first exits its admitted segment. Only its actual terminal event settles the agreement. */
export function finishLodgingWalk(
  game: Game,
  actor: Actor,
  task: Task,
  cancelled: boolean,
) {
  const h = game.housing,
    l = h?.lodging;
  if (
    !h ||
    !l?.orderId ||
    l.residentId !== actor.person.id ||
    l.orderId !== task.spatial?.orderId
  )
    return;
  const arriving = l.phase === "arriving";
  const keepsRoom = arriving ? !cancelled : cancelled;
  if (keepsRoom) {
    l.phase = "occupied";
    delete l.orderId;
  } else delete h.lodging;
  refreshLodgingAccess(game, l.roomId);
  if (arriving)
    return cancelled
      ? "入居を取り消しました。"
      : "居室に到着し、入居を始めました。";
  return cancelled
    ? "退居を取り消し、居室を引き続き使います。"
    : "共用玄関に到着し、退居しました。";
}

export function usualHomeArrival(game: Game, actor: Actor, trip: Task) {
  const l = game.housing?.lodging;
  if (
    l?.phase !== "occupied" ||
    l.returnTo !== "room" ||
    l.residentId !== actor.person.id ||
    actor.location !== game.home ||
    trip.from === game.home ||
    trip.target !== game.home ||
    (trip.kind !== "travel" && trip.kind !== "return") ||
    actor.task
  )
    return;
  if (actor.danger || actor.injury >= 70)
    return "今は移動を控え、共用玄関で休みます。";
  const next = walk(game, actor, l.roomId, "帰宅後に居室へ向かう", "auto");
  return next.error
    ? "共用玄関に着きました。居室への移動は始めません。" + next.error
    : "共用玄関から居室へ向かいます。";
}
