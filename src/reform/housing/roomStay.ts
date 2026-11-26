import type { Actor, Game } from "../sim";
import { fields, integer } from "./saveFields";
import { housingRoomId, housingSourcePoint } from "./topology";

type RoomStayEntry = { actorId: string; roomId: string; minutes: number };

export type RoomStayDay = {
  day: number;
  from: number;
  entries: RoomStayEntry[];
};

export type RoomStay = { version: 1; days: RoomStayDay[] };

const minutesPerDay = 1440;
const calendarDay = (time: number) => Math.floor(time / minutesPerDay) + 1;

/** While crossing a doorway the resident is still exposed to the departure room. */
export function physicalHomeRoom(game: Game, actor: Actor): string | null {
  const h = game.housing;
  const id = actor.person.id;
  if (!h || actor.location !== game.home || !Object.hasOwn(h.state.actors, id))
    return null;
  const point = housingSourcePoint(h.state.actors[id]);
  return point && housingRoomId(point.domainId);
}

export function roomStayMinutes(
  day: RoomStayDay,
  actorId: string,
  roomId: string,
): number {
  return (
    day.entries.find((e) => e.actorId === actorId && e.roomId === roomId)
      ?.minutes ?? 0
  );
}

/** Called once per minute on the live simulation, immediately before spatial movement. */
export function recordRoomStayMinute(game: Game): void {
  const h = game.housing;
  if (!h) return;
  const start = game.time - 1;
  const ledger = (h.roomStay ??= { version: 1, days: [] });
  let day = ledger.days.at(-1);
  if (!day) {
    day = { day: calendarDay(start), from: start, entries: [] };
    ledger.days.push(day);
  }
  for (const actor of game.actors) {
    const roomId = physicalHomeRoom(game, actor);
    if (roomId === null) continue;
    const actorId = actor.person.id;
    const entry = day.entries.find(
      (e) => e.actorId === actorId && e.roomId === roomId,
    );
    if (entry) entry.minutes++;
    else {
      // Save the same ledger even if the simulation visits residents in a different order.
      const index = day.entries.findIndex(
        (e) => e.actorId > actorId || (e.actorId === actorId && e.roomId > roomId),
      );
      const newEntry = { actorId, roomId, minutes: 1 };
      if (index < 0) day.entries.push(newEntry);
      else day.entries.splice(index, 0, newEntry);
    }
  }
  if (game.time % minutesPerDay === 0) {
    if (ledger.days.length === 2) ledger.days.shift();
    ledger.days.push({ day: day.day + 1, from: game.time, entries: [] });
  }
}

export function validRoomStay(value: unknown, game: Game): value is RoomStay {
  if (
    !fields(value, ["version", "days"]) ||
    value.version !== 1 ||
    !Array.isArray(value.days) ||
    value.days.length < 1 ||
    value.days.length > 2
  )
    return false;
  const current = calendarDay(game.time);
  const actors = new Set(game.actors.map((actor) => actor.person.id));
  const rooms = new Set(game.house.rooms.map((room) => room.id));
  for (const [i, row] of value.days.entries()) {
    const expectedDay = current - value.days.length + 1 + i;
    const midnight = (expectedDay - 1) * minutesPerDay;
    const end = Math.min(game.time, midnight + minutesPerDay);
    if (
      !fields(row, ["day", "from", "entries"]) ||
      expectedDay < 1 ||
      row.day !== expectedDay ||
      !integer(row.from, Math.max(480, midnight), end) ||
      (i === 0 && row.from === end) ||
      (i > 0 && row.from !== midnight) ||
      !Array.isArray(row.entries) ||
      row.entries.length > actors.size * Math.min(rooms.size, end - row.from)
    )
      return false;
    const seen = new Set<string>();
    const totals = new Map<string, number>();
    for (const entry of row.entries) {
      if (
        !fields(entry, ["actorId", "roomId", "minutes"]) ||
        typeof entry.actorId !== "string" ||
        !actors.has(entry.actorId) ||
        typeof entry.roomId !== "string" ||
        !rooms.has(entry.roomId) ||
        !integer(entry.minutes, 1, end - row.from)
      )
        return false;
      const key = JSON.stringify([entry.actorId, entry.roomId]);
      const total = (totals.get(entry.actorId) ?? 0) + entry.minutes;
      if (seen.has(key) || total > end - row.from) return false;
      seen.add(key);
      totals.set(entry.actorId, total);
    }
  }
  return true;
}
