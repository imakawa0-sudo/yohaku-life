import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { initialHouse } from "../src/reform/house";
import {
  startHousingGathering,
  startReadyGathering,
} from "../src/reform/housing/gathering";
import { housingPoint } from "../src/reform/housing/topology";
import { exportSlot, importSlot } from "../src/reform/library";
import { makePersona } from "../src/reform/peopleModel";
import {
  advance,
  createGame,
  enableHousing,
  isGame,
  order,
  setHousingRoomAccess,
  type Game,
} from "../src/reform/sim";
import { defaultWorldConfig, generateWorld } from "../src/reform/world";

register(
  "data:text/javascript," +
    encodeURIComponent(
      'export async function load(url, context, next) { if (url.endsWith(".css") || new URL(url).pathname.endsWith(".png")) return { format: "module", source: "export default " + JSON.stringify(url), shortCircuit: true }; return next(url, context); }',
    ),
);
const { Life } = await import("../src/reform/Life");

const names = ["カヤ", "朝の川辺に住む長い名前のスイ", "ナギ"];
const [a, b, c] = ["person-1", "person-2", "person-3"];
function base(count = 2, table = false, house = initialHouse()) {
  if (table) house.rooms[0].fixtures[1].kind = "table";
  return enableHousing(
    createGame(
      names
        .slice(0, count)
        .map((name, index) => ({ ...makePersona(index, 23 + index), name })),
      generateWorld(defaultWorldConfig()),
      "village",
      house,
    ),
    "new",
  );
}
function at(g: Game, id: string, room: string, cell: number) {
  g.housing!.state.actors[id].position = {
    kind: "at",
    point: housingPoint(room, cell),
  };
  g.actors.find((actor) => actor.person.id === id)!.room = room;
}
function life(g: Game, selected = a) {
  const before = JSON.stringify(g);
  const unexpectedCommand = () => assert.fail("render issued a command");
  const html = renderToStaticMarkup(
    createElement(Life, {
      game: g,
      selected,
      onSelect: unexpectedCommand,
      onGame: unexpectedCommand,
    }),
  );
  assert.equal(JSON.stringify(g), before);
  return html;
}
function panel(html: string) {
  const section = html.match(
    /<section[^>]*aria-label="一緒に過ごす"[^>]*>([\s\S]*?)<\/section>/,
  )?.[1];
  assert.ok(section, "生活画面から「一緒に過ごす」を開ける");
  return section;
}
function scene(html: string) {
  const label = html.match(
    /class="yp-scene" role="img" aria-label="([^"]+)"/,
  )?.[1];
  assert.ok(label);
  return label;
}
function begin(g: Game, kind: "talk" | "meal", actorIds: string[]) {
  return startHousingGathering(g, {
    kind,
    actorIds,
    roomId: "living",
    fixtureId: "bench-1",
  });
}

function invitedGathering(kind: "talk" | "meal", guestTravels = false) {
  const game = base(3, true);
  at(game, a, "living", 1);
  at(game, b, guestTravels ? "bedroom" : "living", guestTravels ? 0 : 4);
  at(game, c, "living", 6);
  const active = startHousingGathering(
    setHousingRoomAccess(game, "living", [a, c]),
    {
      kind,
      roomId: "living",
      fixtureId: "bench-1",
      actorIds: [a, b, c],
      invitation: { hostId: a, guestId: b },
    },
  );
  assert.ok(active.housing!.gatherings?.["gathering-1"]?.invitation);
  return active;
}

function sharedCancellationNote(g: Game, who: string) {
  const html = life(g, who);
  const notes = ["この集まりから離れる", "現在の予定を取り消す"].map(
    (label) => {
      const id = html.match(
        new RegExp(
          '<button[^>]*aria-describedby="([^"]+)"[^>]*>' + label + "</button>",
        ),
      )?.[1];
      assert.ok(id, label);
      const note = html.match(new RegExp('id="' + id + '">([^<]+)</'))?.[1];
      assert.ok(note, label);
      return note;
    },
  );
  assert.equal(notes[0], notes[1]);
  return notes[0];
}

test("both cancel buttons distinguish the host ending a three-person talk from the guest leaving two ordinary participants", () => {
  const talk = invitedGathering("talk");
  const host = sharedCancellationNote(talk, a);
  assert.match(host, new RegExp(names[1] + "もこの集まりから離れます"));
  assert.match(host, /この会話は終了します/);
  assert.doesNotMatch(host, /取り置き|区間/);
  const guest = sharedCancellationNote(talk, b);
  assert.match(guest, /この集まりの招待はここで終わります/);
  assert.match(guest, /残る2人の会話予定は続きます/);
  assert.doesNotMatch(guest, /この会話は終了|取り置き/);
  assert.equal(
    order(talk, a, "cancel").housing!.gatherings?.["gathering-1"],
    undefined,
  );
  const remaining = order(talk, b, "cancel").housing!.gatherings![
    "gathering-1"
  ];
  assert.deepEqual(
    remaining.members
      .filter((m) => m.status === "participating")
      .map((m) => m.actorId),
    [a, c],
  );
});

test("meal cancellation previews keep the third diner's seat and return only the portions still reserved by those leaving", () => {
  const planned = invitedGathering("meal");
  const crossing = advance(invitedGathering("meal", true), 1);
  assert.equal(crossing.housing!.state.actors[b].position.kind, "transit");
  const host = sharedCancellationNote(crossing, a);
  assert.match(host, /ナギの食事予定は続きます/);
  assert.match(host, /今の区間を出てから離れます/);
  assert.match(host, /取り置き2食/);
  const guest = sharedCancellationNote(crossing, b);
  assert.match(guest, /残る2人の食事予定は続きます/);
  assert.match(guest, /取り置き1食/);
  const eating = advance(planned, 1);
  const after = order(eating, a, "cancel");
  assert.equal(after.actors[2].task?.kind, "home-gather");
  assert.equal(after.food, eating.food);
  const hostAfterEating = sharedCancellationNote(eating, a);
  assert.match(hostAfterEating, /ナギの食事予定は続きます/);
  assert.doesNotMatch(hostAfterEating, /取り置き|区間/);
});

test("the initial gathering form shows real seat capacity and disables a one-person request", () => {
  const html = panel(life(base()));
  assert.match(html, /会話/);
  assert.match(html, /食事/);
  assert.match(html, /会場/);
  assert.match(html, /居間.*長椅子/);
  assert.match(html, /空き席.*2席/);
  assert.match(html, new RegExp(names[1]));
  assert.match(html, /二人以上/);
  assert.match(html, /<button[^>]*disabled[^>]*>集まりを指示する/);
});

test("a resident who already has a task cannot be selected for a new gathering", () => {
  const html = panel(life(order(base(), b, "wait")));
  const choice = html.match(
    new RegExp("<label[^>]*>((?:(?!</label>).)*" + names[1] + ".*?)</label>"),
  )?.[1];
  assert.ok(choice);
  assert.match(choice, /<input[^>]*disabled/);
  assert.match(choice, /進行中の予定/);
});

test("a layout upgrade conflict reports unmeasured seats for the selected kitchen", () => {
  const house = initialHouse();
  house.rooms[0].fixtures.unshift({
    id: "kitchen-qa",
    kind: "kitchen",
    cell: 10,
  });
  const g = order(
    order(base(3, false, house), a, "need", "social"),
    b,
    "need",
    "social",
  );
  assert.ok(isGame(g));
  const html = panel(life(g, c));
  assert.match(html, /selected="">居間・台所と食卓/);
  assert.match(html, /長椅子の席を保てない/);
  assert.match(html, /間取りで確保できる席<\/dt><dd>確認できません/);
  assert.match(html, /会場の空き席<\/dt><dd>確認できません/);
  assert.match(html, /<button[^>]*disabled[^>]*>集まりを指示する/);
});

test("one free seat is explained differently for a floor plan shortfall and a booking", () => {
  const house = initialHouse();
  const living = house.rooms[0];
  living.fixtures = [living.fixtures[1]];
  living.walls = [1, 2, 7, 9, 10];
  const oneSeat = base(3, false, house);
  const oneBooked = order(base(3), c, "need", "social");
  const narrow = panel(life(oneSeat));
  const reserved = panel(life(oneBooked));
  for (const html of [narrow, reserved]) {
    assert.match(html, /会場の空き席<\/dt><dd>1席/);
  }
  assert.match(narrow, /間取りで確保できる席<\/dt><dd>1席/);
  assert.match(narrow, /隣に使える床が足りません/);
  assert.match(reserved, /間取りで確保できる席<\/dt><dd>2席/);
  assert.match(reserved, /1席は予約済み/);
});

test("waiting members show assigned seats, time to the deadline and the reason talk cannot start yet", () => {
  const g = base();
  at(g, a, "living", 1);
  at(g, b, "bedroom", 0);
  const html = life(begin(g, "talk", [a, b]));
  const controls = panel(html);
  assert.match(controls, /長椅子の席1/);
  assert.match(controls, /長椅子の席2/);
  assert.match(controls, /ほかの人の到着を待っています/);
  assert.match(controls, /予約した席へ向かっています/);
  assert.match(controls, /集合期限まであと19分/);
  assert.doesNotMatch(controls, /再開できます|分で離れます/);
  assert.match(controls, /<button[^>]*disabled[^>]*>揃った人で始める/);
  assert.match(controls, /自席にいる二人が必要/);
  assert.match(controls, /この集まりから離れる/);
  assert.doesNotMatch(html, /完了までの目安/);
});

test("a ready first diner can start early and a withdrawing diner cannot cancel again", () => {
  const g = base();
  at(g, a, "living", 1);
  at(g, b, "bedroom", 0);
  const travelling = advance(begin(g, "meal", [a, b]), 1);
  assert.match(
    panel(life(travelling)),
    /<button(?![^>]*disabled)[^>]*>揃った人で始める/,
  );
  const current = startReadyGathering(travelling, "gathering-1");
  const controls = panel(life(current, b));
  assert.match(controls, /区間の終点で集まりから離れます/);
  assert.doesNotMatch(controls, /再開できます|分で離れます/);
  assert.match(controls, /<button[^>]*disabled[^>]*>この集まりから離れる/);
  assert.match(controls, /自席で食事をしています/);
  assert.doesNotMatch(scene(life(current)), new RegExp(names[1]));
});

test("the scene includes two seated early arrivals and a denied seated peer while excluding the traveller", () => {
  const g = base(3, true);
  at(g, a, "living", 1);
  at(g, b, "bedroom", 0);
  at(g, c, "living", 6);
  const gathering = begin(g, "talk", [a, b, c]);
  const early = scene(life(gathering));
  assert.match(early, /ナギ/);
  assert.doesNotMatch(early, /スイ/);
  assert.doesNotMatch(scene(life(gathering, b)), /カヤ|ナギ/);
  const active = advance(gathering, 6);
  const denied = setHousingRoomAccess(active, "living", [a, b]);
  const html = life(denied);
  assert.match(scene(html), /ナギ/);
  assert.match(panel(html), /利用した時間.*2分/);
  assert.match(panel(html), /一緒に過ごした時間.*2分/);
  const left = life(order(active, c, "cancel"));
  assert.doesNotMatch(scene(left), /ナギ/);
  assert.match(panel(left), /ナギ.*離脱/);
});

test("a gathering's scene excludes a same-cell resident who did not join", () => {
  const g = base(3);
  at(g, a, "living", 1);
  at(g, b, "living", 4);
  at(g, c, "living", 1);
  const image = scene(life(begin(g, "talk", [a, b])));
  assert.match(image, /スイ/);
  assert.doesNotMatch(image, /ナギ/);
});

test("a legacy unlocated constructor resident can open the Life gathering form after import", () => {
  const person = { ...makePersona(0, 23), id: "constructor" };
  const origin = createGame(
    [person],
    generateWorld(defaultWorldConfig()),
    "village",
  );
  const game = enableHousing(origin, "legacy");
  const loaded = importSlot(
    exportSlot({ id: "legacy", name: "旧手帳", origin, game }),
  );
  assert.deepEqual(loaded.origin, origin);
  assert.ok(isGame(loaded.game));
  assert.equal(
    Object.hasOwn(loaded.game.housing!.state.actors, person.id),
    false,
  );
  assert.match(panel(life(loaded.game, person.id)), /集まりを指示する/);
});

test("stopped talkers see their own departure time and the next minute's recovery after an access edit", () => {
  const g = base(3, true);
  [a, b, c].forEach((id, i) => at(g, id, "living", [1, 4, 6][i]));
  const two = advance(begin(g, "talk", [a, b, c]), 2);
  const bc = advance(setHousingRoomAccess(two, "living", [b, c]), 13);
  const stopped = advance(setHousingRoomAccess(bc, "living", [a]), 1);
  const rows = (game: Game) =>
    [...panel(life(game)).matchAll(/<li>([\s\S]*?)<\/li>/g)].map(
      (match) => match[1],
    );
  const [first, ...others] = rows(stopped);
  assert.match(first, /話し相手.*あと1分で離れます/);
  assert.equal(others.length, 2);
  for (const row of others) assert.match(row, /許可.*あと14分で離れます/);
  const restored = setHousingRoomAccess(stopped, "living", [a, b]);
  const [ra, rb, rc] = rows(restored);
  for (const row of [ra, rb]) {
    assert.match(row, /次の1分から会話を再開できます/);
    assert.doesNotMatch(row, /分で離れます/);
  }
  assert.match(rc, /あと14分で離れます/);
  const resumed = advance(restored, 1);
  assert.doesNotMatch(rows(resumed)[0], /再開できます|分で離れます/);
  assert.doesNotMatch(
    rows(order(resumed, c, "cancel"))[2],
    /再開できます|分で離れます/,
  );
  assert.match(rows(order(resumed, c, "cancel"))[2], /離脱済み/);
});

test("a stopped diner can resume alone as soon as their seat is permitted", () => {
  const g = base();
  at(g, a, "living", 1);
  at(g, b, "living", 4);
  const eating = advance(begin(g, "meal", [a, b]), 2);
  const stopped = advance(setHousingRoomAccess(eating, "living", []), 14);
  assert.match(panel(life(stopped)), /許可.*あと1分で離れます/);
  const restored = setHousingRoomAccess(stopped, "living", [a]);
  assert.match(panel(life(restored)), /次の1分から食事を再開できます/);
  assert.equal(restored.time, stopped.time);
});
