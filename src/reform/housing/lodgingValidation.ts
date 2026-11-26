import type { Game } from "../sim";
import { fields } from "./saveFields";
import { housingPoint } from "./topology";
import type { HousingRuntime } from "./types";

export function validLodging(h: HousingRuntime, game: Game): boolean {
  if (!Object.hasOwn(h, "lodging")) return true;
  const stay = h.lodging;
  if (
    !fields(
      stay,
      ["version", "providerId", "residentId", "roomId", "phase", "returnTo"],
      ["orderId"],
    ) ||
    stay.version !== 1 ||
    !["offered", "arriving", "occupied", "leaving"].includes(stay.phase) ||
    !["entrance", "room"].includes(stay.returnTo) ||
    stay.providerId === stay.residentId ||
    !game.actors.some((a) => a.person.id === stay.providerId) ||
    stay.roomId === "living" ||
    stay.roomId === "yard" ||
    !game.house.rooms.some((room) => room.id === stay.roomId) ||
    !Object.hasOwn(h.controls.roomAccess, stay.roomId)
  )
    return false;
  const resident = game.actors.find((a) => a.person.id === stay.residentId);
  if (!resident) return false;
  if (stay.phase === "offered") {
    const allowed = h.controls.roomAccess[stay.roomId];
    return (
      stay.returnTo === "entrance" &&
      !Object.hasOwn(stay, "orderId") &&
      (allowed === null ||
        (Array.isArray(allowed) && allowed.includes(stay.providerId)))
    );
  }
  if (stay.phase === "occupied") return !Object.hasOwn(stay, "orderId");
  if (stay.phase === "arriving" && stay.returnTo !== "entrance") return false;

  const roomId = stay.phase === "arriving" ? stay.roomId : "living";
  const task = resident.task;
  const walk = h.state.actors[stay.residentId]?.order;
  if (
    !fields(task, [
      "kind",
      "label",
      "target",
      "from",
      "metric",
      "mode",
      "total",
      "remaining",
      "room",
      "reserved",
      "spatial",
    ]) ||
    task.kind !== "home-move" ||
    task.mode !== "direct" ||
    task.metric !== "travel" ||
    task.from !== game.home ||
    resident.location !== game.home ||
    task.room !== roomId ||
    task.target !== JSON.stringify({ roomId, cell: 0 }) ||
    task.remaining !== task.total ||
    !fields(task.reserved, []) ||
    !fields(task.spatial, ["kind", "orderId"]) ||
    task.spatial.kind !== "move" ||
    typeof stay.orderId !== "string" ||
    task.spatial.orderId !== stay.orderId ||
    !walk ||
    walk.id !== stay.orderId ||
    walk.intent.kind !== "move"
  )
    return false;
  return (
    walk.intent.actorId === stay.residentId &&
    walk.intent.destination.domainId === housingPoint(roomId, 0).domainId &&
    walk.intent.destination.cell === 0
  );
}
