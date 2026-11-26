import { editHouse } from "../house";
import { isStockQuantity, type Game } from "../sim";
import { cancelSpatialOrder, issueSpatialOrder } from "../spatial/actions";
import { sameSpatialPoint } from "../spatial/route";
import {
  projectHousingOrderMinutes,
  spatialReasonText,
  type HousingMinute,
} from "./bridge";
import {
  availableWorker,
  workerCandidate,
  workerUnavailable,
} from "./construction";
import type {
  ConstructionResult,
  ConstructionInspection,
} from "./constructionTypes";
import { applyHousingHouseEdit } from "./runtime";
import {
  effectiveRoomAccess,
  housingPoint,
  housingRoomId,
  housingSlotId,
} from "./topology";
import type { BenchRecovery, HousingRuntime } from "./types";

export const benchRecoveryMinutes = 15;
export const benchBoardId = (fixtureId: string) =>
  JSON.stringify(["bench-board", fixtureId]);
const supply = () => housingPoint("living", 0);

/** Carry permission follows the accepted pickup and drop rooms, including in transit. */
export function benchBoardHandling(
  h: HousingRuntime,
  recovery: BenchRecovery,
): string[] | null {
  const item = h.state.items[benchBoardId(recovery.fixtureId)];
  const worker = recovery.assignment?.actorId;
  const pickup =
    (worker && h.state.actors[worker]?.order?.pickupPoint) ||
    (item.position.kind === "at" && item.position.point);
  const pickupRoom = pickup && housingRoomId(pickup.domainId);
  if (!pickupRoom) return [];
  const lists = [
    effectiveRoomAccess(pickupRoom, h.controls, h.lodging),
    h.controls.roomAccess.living,
  ];
  if (lists.every((ids) => ids === null)) return null;
  return Object.keys(h.state.actors)
    .filter((id) => lists.every((ids) => ids === null || ids?.includes(id)))
    .sort();
}

export function refreshBenchHandling(h: HousingRuntime) {
  const r = h.benchRecovery;
  if (r?.phase === "board")
    h.state.items[benchBoardId(r.fixtureId)].carryAllowedActorIds =
      benchBoardHandling(h, r);
}

export function startBenchRecovery(
  game: Game,
  fixtureId: string,
  actorId: string,
): ConstructionResult {
  if (!game.housing)
    return { game, error: "先に住居の移動を有効にしてください。" };
  if (game.housing.benchRecovery)
    return { game, error: "先の解体か板の回収を終えてください。" };
  const room = game.house.rooms.find((r) =>
    r.fixtures.some((f) => f.id === fixtureId && f.kind === "workbench"),
  );
  const fixture = room?.fixtures.find((f) => f.id === fixtureId);
  if (!room || !fixture)
    return { game, error: "設置した木工台を選んでください。" };
  const actor = availableWorker(game, actorId);
  if (!actor) return { game, error: workerUnavailable };

  // Respect other fixtures' use floors as well as reservations on this bench.
  const removed = editHouse(game.house, { type: "remove", id: fixtureId });
  const check = applyHousingHouseEdit(game, removed);
  if (check.error) return { game, error: check.error };
  const { next, h, worker } = workerCandidate(game, actor);
  const slotId = housingSlotId(room.id, fixtureId, 0);
  const result = issueSpatialOrder(h.state, {
    kind: "use",
    actorId,
    slotId,
    useMinutes: benchRecoveryMinutes,
  });
  if (!result.ok) return { game, error: spatialReasonText(result.reason) };
  h.state = result.state;
  h.benchRecovery = {
    version: 1,
    fixtureId,
    roomId: room.id,
    cell: fixture.cell,
    phase: "dismantling",
    assignment: { actorId, orderId: result.orderId },
  };
  worker.task = {
    kind: "home-dismantle",
    label: "木工台を解体する",
    mode: "direct",
    metric: "work",
    from: worker.location,
    room: room.id,
    station: slotId,
    total: benchRecoveryMinutes,
    remaining: benchRecoveryMinutes,
    reserved: {},
    spatial: {
      kind: "use",
      orderId: result.orderId,
      benchRecoveryId: fixtureId,
    },
  };
  worker.reason = "木工台へ向かい、解体します。";
  return { game: next };
}

export function returnBenchBoard(
  game: Game,
  fixtureId: string,
  actorId: string,
): ConstructionResult {
  const r = game.housing?.benchRecovery;
  if (!r || r.fixtureId !== fixtureId || r.phase !== "board" || r.assignment)
    return { game, error: "床に置かれた未回収の板を選んでください。" };
  const itemId = benchBoardId(fixtureId);
  const pos = game.housing!.state.items[itemId].position;
  if (pos.kind !== "at" || sameSpatialPoint(pos.point, supply()))
    return { game, error: "供給口の板は共同備蓄へ戻せます。" };
  const actor = availableWorker(game, actorId);
  if (!actor) return { game, error: workerUnavailable };
  const { next, h, worker } = workerCandidate(game, actor);
  const result = issueSpatialOrder(h.state, {
    kind: "carry",
    actorId,
    payload: { kind: "item", id: itemId },
    destination: supply(),
  });
  if (!result.ok) return { game, error: spatialReasonText(result.reason) };
  h.state = result.state;
  h.benchRecovery!.assignment = { actorId, orderId: result.orderId };
  worker.task = {
    kind: "home-salvage",
    label: "解体した板を供給口へ運ぶ",
    mode: "direct",
    metric: "travel",
    from: worker.location,
    total: 1,
    remaining: 1,
    reserved: {},
    spatial: {
      kind: "carry",
      orderId: result.orderId,
      benchRecoveryId: fixtureId,
    },
  };
  worker.reason = "解体した板を供給口へ運びます。";
  return { game: next };
}

function inspect(
  result: ConstructionResult,
  actorId: string,
): ConstructionInspection {
  if (result.error) return { ok: false, disabled: result.error, minutes: null };
  const worker = result.game.actors.find((a) => a.person.id === actorId)!;
  return { ok: true, minutes: projectHousingOrderMinutes(result.game, worker) };
}
export function inspectBenchRecovery(
  game: Game,
  fixtureId: string,
  actorId: string,
) {
  return inspect(startBenchRecovery(game, fixtureId, actorId), actorId);
}
export function inspectBenchReturn(
  game: Game,
  fixtureId: string,
  actorId: string,
) {
  return inspect(returnBenchBoard(game, fixtureId, actorId), actorId);
}

function release(game: Game, r: BenchRecovery) {
  const worker = game.actors.find(
    (a) => a.person.id === r.assignment!.actorId,
  )!;
  worker.task = null;
  delete r.assignment;
  if (r.phase === "dismantling") delete game.housing!.benchRecovery;
  else refreshBenchHandling(game.housing!);
  return worker;
}
export function cancelBenchActor(game: Game, actorId: string) {
  const h = game.housing!;
  const r = h.benchRecovery;
  if (!r || r.assignment?.actorId !== actorId) return;
  h.state = cancelSpatialOrder(h.state, actorId).state;
  const worker = game.actors.find((a) => a.person.id === actorId)!;
  if (h.state.actors[actorId].order)
    worker.reason = "現在の移動区間を出てから担当を解除します。";
  else {
    release(game, r);
    worker.reason =
      r.phase === "board"
        ? "運搬を取り消し、板を床に残しました。"
        : "解体を取り消し、木工台を残しました。";
  }
}
export function cancelBenchRecovery(
  game: Game,
  fixtureId: string,
): ConstructionResult {
  const r = game.housing?.benchRecovery;
  if (!r || r.fixtureId !== fixtureId || !r.assignment)
    return { game, error: "取り消す担当がありません。" };
  const next = structuredClone(game);
  cancelBenchActor(next, r.assignment.actorId);
  return { game: next };
}

export function prepareBenchMinute(game: Game) {
  const h = game.housing;
  const r = h?.benchRecovery;
  if (!h || !r?.assignment) return;
  const id = r.assignment.actorId;
  if (h.state.actors[id].order?.phase === "exiting-after-cancel") return;
  const allowed =
    r.phase === "board"
      ? h.state.items[benchBoardId(r.fixtureId)].carryAllowedActorIds
      : h.state.slots[housingSlotId(r.roomId, r.fixtureId, 0)].allowedActorIds;
  const actor = game.actors.find((a) => a.person.id === id)!;
  if (
    actor.danger ||
    actor.injury >= 70 ||
    (allowed !== null && !allowed.includes(id))
  )
    cancelBenchActor(game, id);
}

function boardAtSupply(game: Game, fixtureId: string) {
  const h = game.housing;
  const r = h?.benchRecovery;
  if (
    !h ||
    !r ||
    r.phase !== "board" ||
    r.fixtureId !== fixtureId ||
    r.assignment
  )
    return false;
  const pos = h.state.items[benchBoardId(fixtureId)].position;
  return pos.kind === "at" && sameSpatialPoint(pos.point, supply());
}
export function reclaimBenchBoard(
  game: Game,
  fixtureId: string,
): ConstructionResult {
  if (!boardAtSupply(game, fixtureId))
    return { game, error: "板を供給口へ運んでください。" };
  if (!isStockQuantity(game.wood + 1))
    return { game, error: "共同備蓄に木材1を戻す空きがありません。" };
  const next = structuredClone(game);
  delete next.housing!.state.items[benchBoardId(fixtureId)];
  delete next.housing!.benchRecovery;
  next.wood++;
  return { game: next };
}

/** Clear this minute's task binding before any completed projects validate the house. */
export function finishBenchMinute(
  game: Game,
  minutes: Map<string, HousingMinute>,
) {
  const r = game.housing?.benchRecovery;
  if (!r?.assignment) return;
  const actorId = r.assignment.actorId;
  const tick = minutes.get(actorId);
  if (!tick?.terminal) return;
  const worker = release(game, r);
  if (tick.terminal === "cancel") {
    worker.reason =
      r.phase === "board"
        ? "運搬を中断し、板を床に残しました。"
        : "解体を中断し、木工台を残しました。";
    return;
  }
  return { receipt: r, actorId };
}

/** All normal tasks and stock adjustments for the minute have settled. */
export function settleBenchFinish(
  game: Game,
  end: NonNullable<ReturnType<typeof finishBenchMinute>>,
) {
  const r = end.receipt;
  const worker = game.actors.find((a) => a.person.id === end.actorId)!;
  if (r.phase === "board") {
    const result = reclaimBenchBoard(game, r.fixtureId);
    worker.reason =
      result.error ?? "解体した板を供給口へ届け、木材1を共同備蓄に戻しました。";
    if (!result.error) {
      result.game.actors.find((a) => a.person.id === end.actorId)!.reason =
        worker.reason;
      Object.assign(game, result.game);
    }
    return;
  }
  const house = editHouse(game.house, { type: "remove", id: r.fixtureId });
  const result = applyHousingHouseEdit(game, house);
  if (result.error) {
    worker.reason = "木工台を残しました。" + result.error;
    return;
  }
  const h = result.game.housing!;
  h.benchRecovery = { ...r, phase: "board" };
  const itemId = benchBoardId(r.fixtureId);
  h.state.items[itemId] = {
    id: itemId,
    position: { kind: "at", point: housingPoint(r.roomId, r.cell) },
    carryAllowedActorIds: null,
  };
  refreshBenchHandling(h);
  result.game.actors.find((a) => a.person.id === end.actorId)!.reason =
    "木工台を解体し、板1枚を元の床に置きました。";
  Object.assign(game, result.game);
}
