import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup as render } from "react-dom/server";
import { advance, order, type Game } from "../src/reform/sim";
import { createRoomInsulation } from "../src/reform/housing/insulation";
import { reserveConstructionMaterial } from "../src/reform/housing/construction";
import {
  base,
  building,
  hauling,
  one,
  two,
  ok,
  planId,
  planned,
} from "./helpers/construction";
register(
  "data:text/javascript," +
    encodeURIComponent(
      'export async function load(url, context, next) { if (url.endsWith(".css") || new URL(url).pathname.endsWith(".png")) return { format: "module", source: "export default " + JSON.stringify(url), shortCircuit: true }; return next(url, context); }',
    ),
);
const { Life } = await import("../src/reform/Life");
const { ConstructionPanel } = await import("../src/reform/ConstructionPanel");
const unexpected = () => assert.fail("render issued a command");
const project = (g = base()) =>
  ok(createRoomInsulation(g, { roomId: "bedroom", stagingCell: 2 }));
const finished = () =>
  advance(
    building(
      advance(
        order(
          hauling(ok(reserveConstructionMaterial(project(), planId))),
          two,
          "work",
          "care",
        ),
        6,
      ),
    ),
    30,
  );
function panel(Component: typeof ConstructionPanel, game: Game) {
  const before = JSON.stringify(game);
  const html = render(createElement(Component, { game, onGame: unexpected }));
  assert.equal(JSON.stringify(game), before);
  return html;
}
function life(game: Game, selected = one) {
  return render(
    createElement(Life, {
      game,
      selected,
      onSelect: unexpected,
      onGame: unexpected,
    }),
  );
}
test("addition panel does not duplicate an insulation project but blocks competing planning", () => {
  const html = panel(ConstructionPanel, project());
  assert.doesNotMatch(html, /class="lf-construction-card"/);
  assert.match(html, /<button[^>]*disabled[^>]*>計画する/);
});
test("frost label distinguishes the selected resident's effective protection rather than household history", () => {
  const game = finished();
  game.time = 60 * 1440 + 480;
  game.housing!.state.time = game.time;
  assert.match(life(game), /寒さ対策：この部屋で対策済み/);
  assert.match(life(game, two), /寒さ対策：未対策/);
  assert.match(
    life({ ...game, insulated: true }, two),
    /寒さ対策：家全体で対策済み/,
  );
});

const { InsulationPanel } = await import("../src/reform/InsulationPanel");
test("planning lists only indoor rooms, and advertises the actual material and work cost even at zero wood", () => {
  const html = panel(InsulationPanel, { ...base(), wood: 0 });
  assert.match(html, /木材1・施工30分/);
  assert.match(html, /裏庭は対象外/);
  assert.match(html, /<option value="bedroom">寝室/);
  assert.doesNotMatch(html, /<option value="yard"/);
  assert.match(html, /計画は無料/);
});
test("only the material reservation requires stock, and provision costs one wood not six", () => {
  const html = panel(InsulationPanel, project({ ...base(), wood: 0 }));
  assert.match(html, /<button[^>]*disabled[^>]*>木材1を取り置く/);
  assert.match(html, /木材1が必要/);
  const enough = panel(InsulationPanel, project({ ...base(), wood: 1 }));
  assert.match(enough, /<button(?![^>]*disabled)[^>]*>木材1を取り置く/);
  assert.doesNotMatch(enough, /木材6/);
});
test("the insulation panel blocks planning during additions without duplicating the card", () => {
  const html = panel(InsulationPanel, planned());
  assert.doesNotMatch(html, /class="lf-construction-card"/);
  assert.match(html, /<button[^>]*disabled[^>]*>寒さ対策を計画する/);
  assert.match(html, /先の工事を終えるか/);
});
test("completed room is not selectable for another retrofit, and whole-home protection does not hide an existing project", () => {
  assert.match(
    panel(InsulationPanel, finished()),
    /<option[^>]*value="bedroom"[^>]*disabled|<option[^>]*disabled[^>]*value="bedroom"/,
  );
  const blocked = panel(InsulationPanel, { ...base(), insulated: true });
  assert.match(blocked, /家全体の寒さ対策が済んでいます/);
  const active = panel(InsulationPanel, { ...project(), insulated: true });
  assert.match(active, /この工事を取り消す/);
  assert.match(active, /木材1を取り置く/);
});
