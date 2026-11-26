import type { Actor, Game } from "../sim";
import { housingRoomId, housingSourcePoint } from "./topology";

export function isIndoorHousingRoom(game: Game, roomId: string): boolean {
  return (
    roomId !== "yard" && game.house.rooms.some((room) => room.id === roomId)
  );
}

export function isRoomInsulated(game: Game, roomId: string): boolean {
  return Object.values(game.housing?.construction?.plans ?? {}).some(
    (plan) =>
      plan.kind === "insulation" &&
      plan.status === "completed" &&
      plan.roomId === roomId,
  );
}

export function homeColdProtection(
  game: Game,
  actor: Actor,
): "whole-home" | "room" | null {
  const housing = game.housing;
  const id = actor.person.id;
  if (
    actor.location !== game.home ||
    housing?.unlocated[id]?.reason === "regional-travel"
  )
    return null;
  if (game.insulated) return "whole-home";
  if (!housing || !Object.hasOwn(housing.state.actors, id)) return null;
  const point = housingSourcePoint(housing.state.actors[id]);
  const roomId = point && housingRoomId(point.domainId);
  return roomId && isRoomInsulated(game, roomId) ? "room" : null;
}
