import test from "node:test";
import assert from "node:assert/strict";
import { createGame, LOCATIONS, serialize } from "../src/game/engine.ts";
import {
  getLocationScene,
  getLocationSummary,
  LOCATION_SCENES,
} from "../src/game/content.ts";
import type { LocationId } from "../src/game/types.ts";

const text = (scene: ReturnType<typeof getLocationScene>) =>
  [scene.title, ...scene.paragraphs, scene.detail].join(" ");

test("Reading every current place preserves the world and the static description templates", () => {
  const state = createGame(20261120);
  state.enemy.defeated = true;
  state.flags.suppliesRecovered = true;
  state.flags.safeSuppliesRecovered = true;
  const before = serialize(state);
  const templates = JSON.stringify(LOCATION_SCENES);
  for (const location of Object.keys(LOCATION_SCENES) as LocationId[]) {
    const scene = getLocationScene(state, location);
    assert.equal(scene.paragraphs.length, 2);
    assert.ok(scene.title && scene.detail);
    scene.paragraphs.push("A caller cannot rewrite the shared template.");
  }
  assert.equal(serialize(state), before);
  assert.equal(JSON.stringify(LOCATION_SCENES), templates);
  assert.deepEqual(getLocationScene(state, "home"), LOCATION_SCENES.home);
});

test("A retreated guard and recovered stores remain cleared when revisiting the road and ruins", () => {
  const state = createGame(20261120);
  assert.match(text(getLocationScene(state, "ruins")), /相手が立っている/);
  state.enemy.defeated = true;
  assert.doesNotMatch(
    text(getLocationScene(state, "ruins")),
    /相手が立っている/,
  );
  assert.match(text(getLocationScene(state, "ruins")), /残る物資を回収/);
  state.flags.suppliesRecovered = true;
  state.flags.safeSuppliesRecovered = true;
  assert.match(
    text(getLocationScene(state, "road")),
    /廃屋と木陰の物資は回収済み/,
  );
  assert.doesNotMatch(
    text(getLocationScene(state, "road")),
    /近づく者を歓迎しない|この先には危険/,
  );
  const ruins = text(getLocationScene(state, "ruins"));
  assert.match(ruins, /すでに回収してある/);
  assert.doesNotMatch(
    ruins,
    /まだ持ち帰れる物資|物資が残るという|相手が立っている/,
  );
});

test("The side route's supplies are independent of the ruins and a moved guard is described at the actual place", () => {
  const state = createGame(20261120);
  delete state.flags.safeSuppliesRecovered;
  assert.match(
    text(getLocationScene(state, "shelter")),
    /荷物が、壁の際に残っている/,
  );
  state.flags.safeSuppliesRecovered = true;
  const side = text(getLocationScene(state, "shelter"));
  assert.match(side, /この脇道の物資は回収済み/);
  assert.match(side, /正面の物資はまだ残る/);
  assert.doesNotMatch(side, /置き去りの小さな荷物/);
  state.enemy.location = "road";
  assert.match(text(getLocationScene(state, "road")), /この道に相手がいる/);
  assert.doesNotMatch(
    text(getLocationScene(state, "ruins")),
    /相手が立っている/,
  );
  state.flags.suppliesRecovered = true;
  assert.match(
    text(getLocationScene(state, "shelter")),
    /廃屋も、この脇道も、回収はひと区切り/,
  );
});

test("Destination summaries preserve the world, the short base copy, and the long scene templates", () => {
  const state = createGame(20261120);
  const before = serialize(state);
  const templates = JSON.stringify({ LOCATIONS, LOCATION_SCENES });
  for (const location of Object.keys(LOCATIONS) as LocationId[]) {
    const summary = getLocationSummary(state, location);
    assert.ok(summary.length > 0);
    assert.ok(summary.length <= LOCATIONS[location].description.length);
    if (["road", "ruins", "shelter"].includes(location))
      assert.ok(summary.split("。").filter(Boolean).length <= 2);
  }
  for (const location of ["home", "kitchen", "bedroom", "garden"] as const)
    assert.equal(
      getLocationSummary(state, location),
      LOCATIONS[location].description,
    );
  assert.equal(serialize(state), before);
  assert.equal(JSON.stringify({ LOCATIONS, LOCATION_SCENES }), templates);
});

test("Destination summaries distinguish recovered caches without keeping a retreated guard", () => {
  const state = createGame(20261120);
  assert.match(getLocationSummary(state, "ruins"), /物資が残る.*流れ者が入口/);
  state.enemy.defeated = true;
  assert.match(
    getLocationSummary(state, "ruins"),
    /物資が残る.*見張りの姿はない/,
  );
  state.flags.suppliesRecovered = true;
  delete state.flags.safeSuppliesRecovered;
  assert.match(getLocationSummary(state, "ruins"), /物資は回収済み/);
  assert.doesNotMatch(
    getLocationSummary(state, "ruins"),
    /物資が残る|流れ者が入口/,
  );
  assert.match(getLocationSummary(state, "shelter"), /少量の物資を回収できる/);
  assert.match(getLocationSummary(state, "road"), /木陰の迂回路には物資が残る/);
  state.flags.safeSuppliesRecovered = true;
  assert.match(getLocationSummary(state, "shelter"), /物資は回収済み/);
  assert.doesNotMatch(
    getLocationSummary(state, "shelter"),
    /物資が残る|回収できる/,
  );
  assert.match(
    getLocationSummary(state, "road"),
    /置き場と木陰の物資は回収済み/,
  );
  state.flags.suppliesRecovered = false;
  assert.match(getLocationSummary(state, "ruins"), /物資が残る/);
  assert.match(
    getLocationSummary(state, "road"),
    /置き場の物資は残り、木陰は回収済み/,
  );
});

test("Destination summaries place the active guard at the actual destination", () => {
  const state = createGame(20261120);
  state.enemy.location = "road";
  assert.match(getLocationSummary(state, "road"), /流れ者が道に立っている/);
  assert.doesNotMatch(
    getLocationSummary(state, "ruins"),
    /流れ者が入口を見張っている/,
  );
  state.enemy.location = "shelter";
  assert.match(getLocationSummary(state, "shelter"), /脇道に流れ者がいる/);
  assert.doesNotMatch(getLocationSummary(state, "shelter"), /安全|争わず/);
  assert.match(getLocationSummary(state, "road"), /木陰の迂回路に流れ者がいる/);
  state.flags.safeSuppliesRecovered = true;
  assert.match(getLocationSummary(state, "shelter"), /回収済み.*流れ者がいる/);
  state.enemy.location = "home";
  assert.match(getLocationSummary(state, "home"), /この場所に流れ者がいる/);
  state.enemy.defeated = true;
  assert.equal(getLocationSummary(state, "home"), LOCATIONS.home.description);
  assert.doesNotMatch(
    getLocationSummary(state, "road"),
    /流れ者がいる|流れ者が道に/,
  );
  const before = serialize(state);
  for (const location of Object.keys(LOCATIONS) as LocationId[])
    getLocationSummary(state, location);
  assert.equal(serialize(state), before);
});
