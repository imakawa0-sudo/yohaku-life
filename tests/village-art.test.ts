import test from "node:test";
import assert from "node:assert/strict";
import { advance, command, createGame, deserialize, getCarryLoad, getWishProgress, serialize } from "../src/game/engine";
import { getVillageArt } from "../src/game/village-art";
import type { ActionKind, Command, GameState } from "../src/game/types";

const aki = (s: GameState) => s.residents.find(person => person.id === "aki")!;
const hear = { type: "hear-village-art", residentId: "aki" } as const;
const offer = (craftId: number, residentId = "aki") => ({ type: "exhibit-village-art", residentId, craftId } as const);
function act(s: GameState, cmd: Command): GameState {
  const result = command(s, cmd);
  assert.equal(result.error, undefined, result.error);
  return result.state;
}
function complete(s: GameState, kind: ActionKind, target?: string, subjectEventId?: number): GameState {
  s = act(s, { type: "assign", residentIds: ["aki"], kind, target, subjectEventId });
  const id = aki(s).action!.id;
  for (let n = 0; n < 300 && aki(s).action?.id === id; n++) s = advance(s, 1);
  assert.notEqual(aki(s).action?.id, id);
  return s;
}
function fail(s: GameState, cmd: Command) {
  const before = serialize(s);
  const result = command(s, cmd);
  assert.ok(result.error);
  assert.equal(result.state, s);
  assert.equal(serialize(s), before);
}
function withCarving() {
  let s = createGame(138, "trader");
  s = complete(s, "move", "reedbank");
  s = complete(s, "observe");
  const reed = s.life!.events.find(event => event.kind === "quiet")!.id;
  s = complete(s, "move", "lodge");
  s = complete(s, "hobby", undefined, reed);
  s = complete(s, "move", "village");
  return s;
}

test("A traveller can leave a carving in the village, hear back on another day and choose a second landscape", () => {
  let s = withCarving();
  const firstId = s.life!.crafts[0].id;
  const before = serialize(s);
  assert.deepEqual(getVillageArt(s, "aki").choices.map(c => c.craftId), [firstId]);
  assert.equal(serialize(s), before);
  const weight = getCarryLoad(s, "aki").weight;
  const offeredAt = s.minutes;
  s = act(s, offer(firstId));
  assert.equal(s.minutes, offeredAt);
  assert.ok(Math.abs(weight - getCarryLoad(s, "aki").weight - 0.2) < 1e-9);
  assert.equal(s.life?.shelf, undefined);
  assert.equal(getVillageArt(s, "aki").first?.displayLocation, "village");
  assert.equal(getVillageArt(s, "aki").feedback, undefined);
  assert.match(getWishProgress(s, "aki").reason!, /舟宿/);
  fail(s, hear);
  fail(s, offer(firstId));
  s = deserialize(serialize(s));
  // A controlled clock jump isolates the next-day and opening boundaries.
  s.minutes = 1440 + 479;
  fail(s, hear);
  s.minutes++;
  s = act(s, hear);
  assert.match(getVillageArt(s, "aki").feedback!, /上流の葦原/);
  assert.equal(getVillageArt(s, "aki").heardAt, s.minutes);
  fail(s, hear);
  s = complete(s, "observe");
  const villageView = s.life!.events.find(event => event.kind === "quiet" && event.location === "village")!;
  s = complete(s, "move", "lodge");
  assert.equal(getVillageArt(s, "aki").first?.displayLocation, "village");
  assert.equal(getWishProgress(s, "aki").nextAction?.kind, "hobby");
  const reed = s.life!.crafts[0].subjectEventId!;
  s = complete(s, "hobby", undefined, reed);
  s = complete(s, "hobby", undefined, villageView.id);
  const [, same, different] = s.life!.crafts;
  fail(s, offer(different.id));
  s = complete(s, "move", "village");
  assert.deepEqual(getVillageArt(s, "aki").choices.map(c => c.craftId), [different.id]);
  fail(s, offer(same.id));
  s = act(s, offer(different.id));
  const final = deserialize(serialize(s));
  assert.equal(getVillageArt(final, "aki").companion?.id, different.id);
  assert.equal(final.life!.crafts.filter(piece => piece.displayLocation === "village").length, 2);
  assert.equal(final.life!.crafts.find(piece => piece.id === same.id)?.displayedAt, undefined);
  assert.deepEqual(final.logs.at(-1)?.actors, ["aki", "village-trader"]);
  fail(final, hear);
  fail(final, offer(same.id));
  const forged = structuredClone(final);
  forged.life!.events = forged.life!.events.filter(event => event.kind !== "village-art-feedback");
  assert.throws(() => deserialize(serialize(forged)));
});

test("Only the author in contact with the shopkeeper can show a piece or receive a reply", () => {
  let s = withCarving();
  const id = s.life!.crafts[0].id;
  fail(s, offer(id, "mio"));
  const afterClosing = structuredClone(s);
  afterClosing.minutes = 1080;
  fail(afterClosing, offer(id));
  fail(s, offer(id + 1));
  const moving = act(s, { type: "assign", residentIds: ["aki"], kind: "move", target: "reedbank" });
  fail(moving, offer(id));
  s = act(s, offer(id));
  s.minutes += 1440;
  s = act(s, hear);
  for (const change of [
    (state: GameState) => { state.life!.events.find(event => event.kind === "village-art-feedback")!.time -= 1440; },
    (state: GameState) => { state.life!.events.find(event => event.kind === "village-art-feedback")!.location = "lodge"; },
    (state: GameState) => { state.life!.crafts[0].displayLocation = "home"; },
    (state: GameState) => {
      const event = state.life!.events.find(entry => entry.kind === "display")!;
      state.life!.wishes.aki = { eventId: event.id, completedAt: event.time };
    },
    (state: GameState) => { state.life!.events.find(event => event.kind === "display")!.witnesses = []; },
  ]) {
    const broken = structuredClone(s);
    change(broken);
    assert.throws(() => deserialize(serialize(broken)));
  }
});

test("An unthemed carving can open an artist's shelf, while a witness cannot submit or answer for them", () => {
  let s = createGame(412);
  s = complete(s, "hobby");
  const piece = s.life!.crafts[0];
  s = complete(s, "move", "village");
  // A household member already present at the shop can witness the exchange.
  const mio = s.residents.find(person => person.id === "mio")!;
  mio.location = "village";
  mio.action = null;
  mio.suspended = null;
  fail(s, offer(piece.id, mio.id));
  assert.equal(getVillageArt(s, mio.id).choices.length, 0);
  s = act(s, offer(piece.id));
  assert.ok(s.logs.at(-1)?.witnesses.includes(mio.id));
  assert.equal(getVillageArt(s, mio.id).first, undefined);
  s.minutes += 1440;
  fail(s, { type: "hear-village-art", residentId: mio.id });
  s = act(s, hear);
  assert.match(getVillageArt(s, "aki").feedback!, /あなたが旅先で見た景色/);
  assert.equal(getVillageArt(s, mio.id).heardAt, undefined);
});
