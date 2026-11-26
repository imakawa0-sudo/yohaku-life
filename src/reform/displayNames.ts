import type { Room } from "./house";
import type { Actor, Game } from "./sim";

// Ordinals follow the saved resident/room order, not the current picker state.
export function residentLabel(game: Game, actor: Actor): string {
  const sameName = game.actors.filter(
    (a) => a.person.name === actor.person.name,
  );
  return sameName.length > 1
    ? `${actor.person.name}（同名の${sameName.findIndex((a) => a.person.id === actor.person.id) + 1}人目）`
    : actor.person.name;
}

export function roomLabel(rooms: Room[], room: Room): string {
  const sameName = rooms.filter((r) => r.name === room.name);
  return sameName.length > 1
    ? `${room.name}（同名の${sameName.findIndex((r) => r.id === room.id) + 1}室目）`
    : room.name;
}
