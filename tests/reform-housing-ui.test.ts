import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup as render } from "react-dom/server";
import {
  advance,
  createGame,
  enableHousing,
  order,
  setHousingPassage,
  setHousingRoomAccess,
  type Game,
} from "../src/reform/sim";
import { housingStatus } from "../src/reform/housing/presentation";
import { housingLinkId } from "../src/reform/housing/topology";
import { initialHouse } from "../src/reform/house";
import { makePersona } from "../src/reform/peopleModel";
import { defaultWorldConfig, generateWorld } from "../src/reform/world";

// Node renders the real components. Stylesheets are handled by Vite in the browser.
register(
  "data:text/javascript," +
    encodeURIComponent(
      'export async function load(url, context, next) { if (url.endsWith(".css") || new URL(url).pathname.endsWith(".png")) return { format: "module", source: "export default " + JSON.stringify(url), shortCircuit: true }; return next(url, context); }',
    ),
);
const { Life } = await import("../src/reform/Life");
const { PeopleEditor } = await import("../src/reform/People");
const { HousingUpgrade } = await import("../src/reform/HousingPanel");

const people = [
  { ...makePersona(0, 23), name: "カヤ" },
  { ...makePersona(1, 75), name: "スイ" },
];
const one = people[0].id;
function base(count = 1) {
  return createGame(
    people.slice(0, count),
    generateWorld(defaultWorldConfig()),
    "village",
    initialHouse(),
  );
}
const noop = () => {};
function scene(g: Game, id = one) {
  const before = JSON.stringify(g);
  const html = render(
    createElement(Life, {
      game: g,
      selected: id,
      onSelect: noop,
      onGame: noop,
    }),
  );
  assert.equal(JSON.stringify(g), before);
  return html;
}
test("selected resident, real transit segment, fixture destination, use and total time render separately", () => {
  let g = enableHousing(base(2), "new");
  assert.match(
    scene(g, people[1].id),
    new RegExp(people[1].name + "への移動指示"),
  );
  assert.match(scene(g), new RegExp(people[1].name + "の近くへ移動"));
  g = advance(order(g, one, "need", "bladder"), 5);
  const status = housingStatus(g, one);
  assert.equal(status.phase, "move");
  const html = scene(g);
  for (const piece of [
    "移動中",
    status.location,
    status.destination!,
    "設備の利用残り",
    status.useRemaining + "分",
    "完了までの目安",
    status.minutes + "分",
  ])
    assert.ok(html.includes(piece), piece);
  assert.match(scene(advance(g, 3)), /設備を利用中/);
});
test("waiting reason, room permission and clock recovery are visible and distinct", () => {
  const ordered = order(enableHousing(base(), "new"), one, "need", "bladder");
  for (const [g, reason] of [
    [
      setHousingPassage(
        ordered,
        "link",
        housingLinkId("bedroom", "yard"),
        false,
      ),
      "目的地への通路が通れません",
    ],
    [setHousingRoomAccess(ordered, "yard", []), "許可がありません"],
  ] as const) {
    const html = scene(advance(g, 5));
    assert.ok(html.includes(reason));
    assert.match(html, /待機中/);
    assert.match(html, /aria-label="次の行動完了まで進める"[^>]*disabled/);
    assert.match(html, /完了時刻を見積もれません/);
    assert.match(html, /時計を進め/);
  }
});
test("transit cancellation shows actual reservation, release boundary and disabled commands", () => {
  const game = base();
  const hearth = game.house.rooms[0].fixtures.find((f) => f.kind === "hearth")!;
  game.house.rooms[0].fixtures = game.house.rooms[0].fixtures.filter(
    (f) => f !== hearth,
  );
  game.house.rooms[2].fixtures.push({ ...hearth, cell: 1 });
  const g = order(
    advance(order(enableHousing(game, "new"), one, "work", "cook"), 5),
    one,
    "cancel",
  );
  const html = scene(g);
  assert.match(html, /取り消し中/);
  assert.match(html, /食材2/);
  assert.match(html, /区間の終点で予約を解除し、材料を返します/);
  assert.match(html, /data-kind="cancel"[^>]*disabled/);
  assert.match(html, /data-target="hygiene"[^>]*disabled/);
  assert.match(html, /<button[^>]*disabled[^>]*>寝室の入口へ移動/);
});
test("legacy fork and unknown current point explain initialization independently of the old job", () => {
  const old = advance(order(base(), one, "work", "cook"), 5);
  assert.match(
    render(createElement(HousingUpgrade, { game: old, onUpgrade: noop })),
    /住居の移動を使う暮らしに分岐/,
  );
  const migrated = enableHousing(old, "legacy");
  assert.equal(
    render(createElement(HousingUpgrade, { game: migrated, onUpgrade: noop })),
    "",
  );
  const html = scene(migrated);
  assert.match(html, /室内位置は未確定/);
  assert.match(html, /旧方式の予定を残り時間どおりに続けます/);
  assert.match(html, /入口から始めます/);
  assert.doesNotMatch(scene(old), /への移動指示/);
});
test("the creator renders the original ten labeled appearance selectors and all 41 values", () => {
  const html = render(createElement(PeopleEditor, { people, onChange: noop }));
  const inventory: Record<string, string> = {
    顔の輪郭: "oval round angular",
    肌の色: "ivory peach wheat bronze umber",
    髪形: "crop bob wave knot braid",
    髪色: "ink chestnut ash honey silver",
    年代: "young adult elder",
    体格: "slight medium broad",
    目元: "soft straight open",
    顔の特徴: "none freckles scar glasses",
    服装: "shirt apron wrap coat",
    服の色: "moss indigo brick rust plum flax",
  };
  for (const [label, ids] of Object.entries(inventory)) {
    const select =
      html.match(
        new RegExp('<select aria-label="' + label + '"[^>]*>(.*?)</select>'),
      )?.[1] ?? "";
    assert.deepEqual(
      Array.from(select.matchAll(/<option value="([^"]+)"/g), (m) => m[1]),
      ids.split(" "),
      label,
    );
  }
});
test("runtime passage controls and peer movement identify their targets; scene company follows the actual point", () => {
  const initial = base(2);
  initial.house.rooms[0].doors = [1];
  const g = enableHousing(initial, "new");
  const first = scene(g);
  assert.match(first, /居間と寝室の通路を閉める/);
  assert.match(first, /居間の扉（2列1行）を閉める/);
  assert.match(
    first,
    /<fieldset><legend>寝室<\/legend><label><input type="checkbox" checked=""/,
  );
  const sceneDescription = (s: string) =>
    s.match(/class="yp-scene" role="img" aria-label="([^"]+)"/)?.[1] ?? "";
  assert.ok(sceneDescription(first).includes(people[1].name));
  const captive = order(g, people[1].id, "leisure");
  const travel = order(
    captive,
    one,
    "home-move",
    JSON.stringify({ roomId: "bedroom", cell: 0 }),
  );
  const transit = advance(travel, 1);
  assert.ok(!sceneDescription(scene(transit)).includes(people[1].name));
  assert.ok(
    !scene(transit, people[1].id).includes(people[0].name + "の近くへ移動"),
  );
  const home = advance(travel, 3);
  assert.match(scene(home), /寝室の入口/);
  assert.ok(!sceneDescription(scene(home)).includes(people[1].name));
  const denied = setHousingRoomAccess(home, "living", []);
  const restricted = scene(denied);
  assert.match(restricted, /<button[^>]*disabled[^>]*>居間の入口へ移動/);
  assert.match(restricted, /<small[^>]+>入室の許可がありません/);
});

test("regional travellers sharing a site do not appear as confirmed scene companions", () => {
  let g = enableHousing(base(2), "new");
  for (const person of people) g = order(g, person.id, "travel", "landing");
  g = advance(g, Math.max(...g.actors.map((a) => a.task!.remaining)));
  assert.ok(g.actors.every((a) => a.location === "landing"));
  const image = scene(g).match(
    /class="yp-scene" role="img" aria-label="([^"]+)"/,
  )?.[1];
  assert.ok(image);
  assert.ok(!image.includes(people[1].name));
});

test("cold-start corruption and inaccessible storage offer recovery possible from an empty screen", async () => {
  const { default: App } = await import("../src/reform/ReformApp");
  const { LIBRARY_KEY } = await import("../src/reform/library");
  const before = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  try {
    for (const blocked of [true, false]) {
      const bytes = "{";
      const storage = {
        getItem: (key: string) => {
          if (!blocked) throw new Error("unavailable");
          return key === LIBRARY_KEY ? bytes : null;
        },
      };
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: storage,
      });
      const html = render(createElement(App));
      const alert = html.match(/role="alert">([^<]+)</)?.[1];
      assert.ok(alert);
      assert.doesNotMatch(alert, /保存を書き出/);
      if (blocked) {
        assert.match(alert, /別のブラウザ/);
        assert.match(alert, /バックアップ/);
        assert.equal(storage.getItem(LIBRARY_KEY), bytes);
      } else {
        assert.match(alert, /保存設定/);
        assert.match(alert, /もう一度/);
      }
    }
  } finally {
    if (before) Object.defineProperty(globalThis, "localStorage", before);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});

test("reciprocal outdoor talk and aid show the confirmed partner from either participant's scene", () => {
  let g = enableHousing(base(2), "new");
  for (const person of people) g = order(g, person.id, "travel", "landing");
  g = advance(g, Math.max(...g.actors.map((a) => a.task!.remaining)));
  for (const kind of ["talk", "aid"]) {
    const start = structuredClone(g);
    if (kind === "aid") start.actors[1].injury = 20;
    const pair = order(start, one, kind, people[1].id);
    assert.equal(pair.actors[0].task?.partner, people[1].id);
    for (const person of people) {
      const image = scene(pair, person.id).match(
        /class="yp-scene" role="img" aria-label="([^"]+)"/,
      )?.[1];
      assert.ok(image);
      for (const p of people) assert.ok(image.includes(p.name));
    }
  }
});
