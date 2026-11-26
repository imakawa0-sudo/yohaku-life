import type { Game, Task } from "../sim";
import { sameSpatialPoint } from "../spatial/route";
import type { SpatialItem, SpatialOrder } from "../spatial/types";
import {
  benchBoardHandling,
  benchBoardId,
  benchRecoveryMinutes,
} from "./benchRecovery";
import { constructionFloor } from "./constructionTopology";
import { fields, integer } from "./saveFields";
import { housingPoint, housingSlotId } from "./topology";
import type { BenchRecovery, HousingRuntime } from "./types";

function matchesTask(task: Task, receipt: BenchRecovery, order: SpatialOrder) {
  const dismantling = receipt.phase === "dismantling";
  return (
    fields(task, [
      "kind",
      "label",
      "total",
      "remaining",
      "from",
      "metric",
      "mode",
      "reserved",
      "spatial",
      ...(dismantling ? ["room", "station"] : []),
    ]) &&
    task.kind === (dismantling ? "home-dismantle" : "home-salvage") &&
    task.metric === (dismantling ? "work" : "travel") &&
    task.mode === "direct" &&
    fields(task.reserved, []) &&
    fields(task.spatial, ["orderId", "kind", "benchRecoveryId"]) &&
    task.spatial.benchRecoveryId === receipt.fixtureId &&
    task.spatial.orderId === order.id &&
    task.spatial.kind === order.intent.kind
  );
}

function matchesBoardOrder(
  item: SpatialItem,
  task: Task,
  order: SpatialOrder,
): boolean {
  const intent = order.intent;
  return (
    intent.kind === "carry" &&
    intent.payload.kind === "item" &&
    intent.payload.id === item.id &&
    sameSpatialPoint(intent.destination, housingPoint("living", 0)) &&
    !!order.pickupPoint &&
    !sameSpatialPoint(order.pickupPoint, intent.destination) &&
    task.total === 1 &&
    task.remaining === 1 &&
    (item.position.kind === "at"
      ? sameSpatialPoint(item.position.point, order.pickupPoint)
      : item.position.kind === "carried" &&
        item.position.carrierId === intent.actorId)
  );
}

/** The spatial codec checks the reservation and movement. Tie them to the single
 * real workbench or recovered board and the matching household task. */
export function validBenchRecovery(h: HousingRuntime, game: Game): boolean {
  const workers = game.actors.filter(
    ({ task }) =>
      task?.kind === "home-dismantle" ||
      task?.kind === "home-salvage" ||
      (task?.spatial && Object.hasOwn(task.spatial, "benchRecoveryId")),
  );
  if (!Object.hasOwn(h, "benchRecovery")) return workers.length === 0;
  const receipt = h.benchRecovery;
  if (
    !fields(
      receipt,
      ["version", "fixtureId", "roomId", "cell", "phase"],
      ["assignment"],
    ) ||
    receipt.version !== 1 ||
    typeof receipt.fixtureId !== "string" ||
    !receipt.fixtureId ||
    receipt.fixtureId.includes("#") ||
    (receipt.phase !== "dismantling" && receipt.phase !== "board")
  )
    return false;
  const room = game.house.rooms.find((r) => r.id === receipt.roomId);
  if (!room || !integer(receipt.cell, 1, room.width * room.height - 1))
    return false;
  const serial = /^(?:room|fixture)-(\d+)$/.exec(receipt.fixtureId)?.[1];
  // Issued numeric IDs cannot refer to a future fixture after its removal.
  if (serial && Number(serial) >= game.house.nextId) return false;
  const hasWorker = Object.hasOwn(receipt, "assignment");
  if (workers.length !== (hasWorker ? 1 : 0)) return false;

  let order: SpatialOrder | null = null;
  const task = workers[0]?.task;
  if (hasWorker) {
    const assignment = receipt.assignment;
    if (
      !fields(assignment, ["actorId", "orderId"]) ||
      assignment.actorId !== workers[0].person.id ||
      !Object.hasOwn(h.state.actors, assignment.actorId)
    )
      return false;
    order = h.state.actors[assignment.actorId].order;
    if (
      !task ||
      !order ||
      order.id !== assignment.orderId ||
      task.from !== game.home ||
      !matchesTask(task, receipt, order)
    )
      return false;
  }

  if (receipt.phase === "dismantling") {
    const slot = housingSlotId(room.id, receipt.fixtureId, 0);
    return (
      room.fixtures.some(
        (f) =>
          f.id === receipt.fixtureId &&
          f.kind === "workbench" &&
          f.cell === receipt.cell,
      ) &&
      order?.intent.kind === "use" &&
      order.intent.slotId === slot &&
      order.intent.useMinutes === benchRecoveryMinutes &&
      task?.total === benchRecoveryMinutes &&
      task.remaining === order.useRemaining &&
      task.station === slot &&
      task.room === room.id
    );
  }

  if (
    game.house.rooms.some((r) =>
      r.fixtures.some((f) => f.id === receipt.fixtureId),
    )
  )
    return false;
  const itemId = benchBoardId(receipt.fixtureId);
  if (!Object.hasOwn(h.state.items, itemId)) return false;
  const item = h.state.items[itemId];
  if (
    item.position.kind === "at"
      ? !constructionFloor(h, item.position.point)
      : item.position.kind !== "carried" || !order
  )
    return false;
  if (order && (!task || !matchesBoardOrder(item, task, order))) return false;
  const expected = benchBoardHandling(h, receipt);
  const allowed = item.carryAllowedActorIds;
  return expected === null
    ? allowed === null
    : allowed !== null &&
        expected.length === allowed.length &&
        expected.every((id, i) => id === allowed[i]);
}
