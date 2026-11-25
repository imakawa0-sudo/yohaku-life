import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { editHouse, initialHouse } from "../src/reform/house";
import { setPreferredBed } from "../src/reform/housing/bedPreference";
import { housingLinkId } from "../src/reform/housing/topology";
import { makePersona } from "../src/reform/peopleModel";
import {
  advance,
  createGame,
  enableHousing,
  isGame,
  order,
  setHousingPassage,
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
const first = { ...makePersona(0, 23), name: "カヤ" };
const second = { ...makePersona(1, 75), name: "スイ" };
const mat = "mat-1";
const bed = "fixture-1";
const matLabel = "寝室・敷きむしろ（3列3行）";
const bedLabel = "居間・布張りの寝台（4列2行）";
const preferredCopy = "優先する寝床を使う見込みです。";
const fallbackCopy = "別の寝床を使う見込みです。";
const configuredAuto = "自動（優先する寝床を考慮）";
const defaultAuto = "自動（移動と利用が短い設備）";
const unavailable =
  "目的地への通路が通れません。戸・通路の開閉と間取りを確認してください。";

function origin(
  house = editHouse(initialHouse(), {
    type: "build",
    room: "living",
    kind: "bed",
    cell: 7,
  }),
) {
  return createGame(
    [first, second],
    generateWorld(defaultWorldConfig()),
    "village",
    house,
  );
}

function render(game: Game, selected = first.id, explicit = "") {
  assert.ok(isGame(game));
  const before = JSON.stringify(game);
  const unexpectedCommand = () => assert.fail("render issued a command");
  const html = renderToStaticMarkup(
    createElement(Life, {
      game,
      selected,
      onSelect: unexpectedCommand,
      onGame: unexpectedCommand,
      facilitySelection: {
        choices: { energy: explicit },
        choose: unexpectedCommand,
      },
    }),
  );
  assert.equal(JSON.stringify(game), before);
  return html;
}

function policy(html: string) {
  const content = html.match(/暮らしと備蓄の方針([\s\S]*?)<\/details>/)?.[1];
  assert.ok(content, "missing policy fold");
  return content;
}

function bedChoices(html: string) {
  const content = policy(html).match(
    /が優先する寝床<\/label><select[^>]*>([\s\S]*?)<\/select>/,
  )?.[1];
  assert.ok(content, "missing bed choice");
  return content;
}

function restAction(html: string) {
  const content = html.match(
    /<div class="lf-command lf-facility-command">(?=<label[^>]*>休息に使う設備<\/label>)([\s\S]*?)<\/div>/,
  )?.[1];
  assert.ok(content, "missing rest action");
  return content;
}

test("the household policy shows only physical beds and the selected resident's saved value", () => {
  const game = setPreferredBed(enableHousing(origin(), "new"), first.id, mat);
  const html = render(game);
  assert.match(
    policy(html),
    /カヤが優先する仕事[\s\S]*カヤが優先する寝床[\s\S]*世帯の食事/,
  );
  assert.match(
    policy(html),
    /次の休息から優先します。使えない時は別の寝床を探します。今の予定は変わりません。/,
  );
  assert.deepEqual(
    [
      ...bedChoices(html).matchAll(
        /<option value="([^"]*)"( selected="")?>([^<]*)<\/option>/g,
      ),
    ].map(([, value, selected, label]) => [value, !!selected, label]),
    [
      ["", false, "未設定（使える寝床から選ぶ）"],
      [bed, false, bedLabel],
      [mat, true, matLabel],
    ],
  );
});

test("bed policy is absent without housing and stays available outside home", () => {
  const legacy = origin();
  assert.doesNotMatch(render(legacy), /が優先する寝床/);
  const home = setPreferredBed(enableHousing(legacy, "new"), first.id, mat);
  const away = advance(order(home, first.id, "travel", "landing"), 20);
  assert.equal(away.actors[0].location, "landing");
  const html = render(away);
  assert.match(bedChoices(html), /value="mat-1" selected=""/);
  assert.doesNotMatch(html, /休息に使う設備/);
});

test("rest choices disambiguate matching furniture and cells in two rooms with the same name", () => {
  const rooms = editHouse(initialHouse(), {
    type: "room",
    name: "寝室",
    neighbor: "living",
  });
  const house = editHouse(rooms, {
    type: "build",
    room: "room-1",
    kind: "mat",
    cell: 10,
  });
  const game = enableHousing(origin(house), "new");
  const html = render(game);
  for (const choices of [bedChoices(html), restAction(html)]) {
    assert.ok(
      choices.includes('value="mat-1">寝室・敷きむしろ（3列3行、同名の1室目）'),
    );
    assert.ok(
      choices.includes(
        'value="fixture-2">寝室・敷きむしろ（3列3行、同名の2室目）',
      ),
    );
  }
});

test("bed values are read from each resident and each save", () => {
  const home = enableHousing(origin(), "new");
  const oneSave = setPreferredBed(
    setPreferredBed(home, first.id, mat),
    second.id,
    bed,
  );
  const otherSave = setPreferredBed(home, first.id, bed);
  for (const [game, resident, expectedId, name] of [
    [oneSave, first.id, mat, first.name],
    [oneSave, second.id, bed, second.name],
    [otherSave, first.id, bed, first.name],
    [otherSave, second.id, "", second.name],
  ] as const) {
    const html = render(game, resident);
    assert.ok(policy(html).includes(`${name}が優先する寝床`));
    assert.ok(bedChoices(html).includes(`value="${expectedId}" selected=""`));
  }
});

test("automatic rest previews the preferred destination or the fastest available destination when unset", () => {
  const home = enableHousing(origin(), "new");
  const normal = restAction(render(home));
  assert.ok(
    normal.includes(`<option value="" selected="">${defaultAuto}</option>`),
  );
  assert.ok(
    normal.includes(
      `${bedLabel}<br/>現在の見込み　移動3分 ＋ 利用55分（合計58分）`,
    ),
  );
  assert.ok(!normal.includes(preferredCopy));
  assert.ok(!normal.includes(fallbackCopy));
  const preferred = restAction(render(setPreferredBed(home, first.id, mat)));
  assert.ok(
    preferred.includes(
      `<option value="" selected="">${configuredAuto}</option>`,
    ),
  );
  assert.ok(
    preferred.includes(
      `${matLabel}<br/>現在の見込み　移動6分 ＋ 利用85分（合計91分）`,
    ),
  );
  assert.ok(preferred.includes(preferredCopy));
});

test("automatic fallback names the preferred bed and reason alongside the real destination", () => {
  const home = setPreferredBed(enableHousing(origin(), "new"), first.id, mat);
  const closed = setHousingPassage(
    home,
    "link",
    housingLinkId("living", "bedroom"),
    false,
  );
  const preview = restAction(render(closed));
  assert.ok(preview.includes(configuredAuto));
  assert.ok(
    preview.includes(
      `${bedLabel}<br/>現在の見込み　移動3分 ＋ 利用55分（合計58分）`,
    ),
  );
  assert.ok(preview.match(/<small[\s\S]*<\/small>/)?.[0].includes(matLabel));
  assert.ok(preview.includes(unavailable));
  assert.ok(preview.includes(fallbackCopy));
  assert.ok(!preview.includes(preferredCopy));
});

test("one-off preview retains only its own destination or its existing disabled reason", () => {
  const home = setPreferredBed(enableHousing(origin(), "new"), first.id, mat);
  const closed = setHousingPassage(
    home,
    "link",
    housingLinkId("living", "bedroom"),
    false,
  );
  const successful = restAction(render(closed, first.id, bed));
  assert.ok(successful.includes(`value="fixture-1" selected="">${bedLabel}`));
  assert.ok(
    successful.includes(
      `${bedLabel}<br/>現在の見込み　移動3分 ＋ 利用55分（合計58分）`,
    ),
  );
  assert.ok(!successful.includes(unavailable));
  const blocked = restAction(render(closed, first.id, mat));
  assert.match(blocked, /<button[^>]*disabled=""/);
  assert.ok(
    blocked.includes(
      `<small id="lf-order-need-energy" role="status">${unavailable}</small>`,
    ),
  );
  for (const preview of [successful, blocked]) {
    assert.ok(!preview.includes(preferredCopy));
    assert.ok(!preview.includes(fallbackCopy));
  }
});
