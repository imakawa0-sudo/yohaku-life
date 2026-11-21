import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Landscape, describeLandscape } from "../src/components/Landscape.tsx";
import {
  advance,
  command,
  createGame,
  deserialize,
  LOCATIONS,
  serialize,
} from "../src/game/engine.ts";
import type { ActionKind, GameState, LocationId } from "../src/game/types.ts";

function picture(state: GameState, location?: LocationId, residentId = "aki") {
  const resident = state.residents.find((person) => person.id === residentId)!;
  return renderToStaticMarkup(
    createElement(Landscape, { game: state, resident, location }),
  );
}

/** Compare illustration changes without mistaking changed accessible text for new artwork. */
function artwork(svg: string) {
  return svg
    .replace(/<title\b[^>]*>[\s\S]*?<\/title>/g, "")
    .replace(/<desc\b[^>]*>[\s\S]*?<\/desc>/g, "")
    .replace(/\s(?:aria-[\w-]+|data-[\w-]+)="[^"]*"/g, "");
}

function complete(state: GameState, kind: ActionKind, target?: string) {
  const result = command(state, {
    type: "assign",
    residentIds: ["aki"],
    kind,
    ...(target ? { target } : {}),
  });
  assert.equal(result.error, undefined);
  const duration = result.state.residents[0].action!.duration;
  return advance(result.state, duration);
}

test("Morning, day, evening and night change both the explanation and artwork without mutating the seeded world", () => {
  const original = createGame(126);
  const originalSnapshot = serialize(original);
  const phases = new Set<string>();
  const descriptions = new Set<string>();
  const illustrations = new Set<string>();
  for (const hour of [8, 13, 17, 22]) {
    const state = structuredClone(original);
    state.minutes = hour * 60;
    const snapshot = serialize(state);
    const description = describeLandscape(state, state.residents[0]);
    phases.add(description.period);
    descriptions.add(description.caption);
    illustrations.add(artwork(picture(state)));
    assert.ok(description.description.includes(LOCATIONS.home.name));
    assert.equal(
      serialize(state),
      snapshot,
      "Reading and rendering leave time, seed and every saved fact intact",
    );
  }
  assert.equal(phases.size, 4);
  assert.equal(descriptions.size, 4);
  assert.equal(
    illustrations.size,
    4,
    "Changing the time label alone is insufficient",
  );
  assert.equal(serialize(original), originalSnapshot);
});

test("Every current location has its own recognizable illustration and accessible place name", () => {
  const pictures = new Set<string>();
  for (const location of Object.keys(LOCATIONS) as LocationId[]) {
    const state = createGame(126);
    // Keep the population identical so differences must come from the place itself.
    for (const person of state.residents) person.location = location;
    const snapshot = serialize(state);
    const svg = picture(state);
    const description = describeLandscape(state, state.residents[0]);
    assert.equal(description.locationLabel, LOCATIONS[location].name);
    assert.ok(svg.includes(LOCATIONS[location].name));
    assert.match(svg, /role="img"/);
    assert.match(svg, /aria-describedby=/);
    pictures.add(artwork(svg));
    assert.equal(serialize(state), snapshot);
  }
  assert.equal(
    pictures.size,
    Object.keys(LOCATIONS).length,
    "Every base room, outdoor route and new regional destination needs its own view",
  );
});

test("Furnishing, a completed carving, active cooking and recovered supplies visibly follow their actual saved facts", () => {
  let state = createGame(126);
  const bare = artwork(picture(state));
  assert.doesNotMatch(
    describeLandscape(state, state.residents[0]).description,
    /手作りの棚|木彫りが完成|料理中/,
  );
  state = complete(state, "decorate");
  const furnished = artwork(picture(state));
  assert.notEqual(furnished, bare);
  assert.match(
    describeLandscape(state, state.residents[0]).description,
    /手作りの棚/,
  );
  state = complete(state, "hobby");
  const carved = artwork(picture(state));
  assert.notEqual(carved, furnished);
  assert.match(
    describeLandscape(state, state.residents[0]).description,
    /小鳥の木彫りが完成/,
  );
  const cooking = command(state, {
    type: "assign",
    residentIds: ["mio"],
    kind: "cook",
  });
  assert.equal(cooking.error, undefined);
  state = cooking.state;
  assert.notEqual(artwork(picture(state)), carved);
  assert.match(
    describeLandscape(state, state.residents[0]).description,
    /ミオが料理中/,
  );

  const ruins = createGame(126);
  ruins.residents[0].location = "ruins";
  const guarded = artwork(picture(ruins));
  assert.match(
    describeLandscape(ruins, ruins.residents[0]).description,
    /流れ者が物資を守っている/,
  );
  ruins.enemy.defeated = true;
  ruins.flags.suppliesRecovered = true;
  assert.notEqual(artwork(picture(ruins)), guarded);
  assert.match(
    describeLandscape(ruins, ruins.residents[0]).description,
    /流れ者は退いた.*物資は回収済み/,
  );

  ruins.residents[0].location = "shelter";
  const safeSupplies = artwork(picture(ruins));
  ruins.flags.safeSuppliesRecovered = true;
  assert.notEqual(artwork(picture(ruins)), safeSupplies);
  assert.match(
    describeLandscape(ruins, ruins.residents[0]).description,
    /脇道の物資は回収済み/,
  );
});

test("Only residents at the depicted location appear, including when the base view overrides an absent selected resident", () => {
  const state = createGame(126);
  state.residents[1].location = "kitchen";
  state.residents[2].location = "road";
  let svg = picture(state);
  assert.ok(svg.includes("アキ"));
  assert.ok(!svg.includes("ミオ"));
  assert.ok(!svg.includes("レン"));
  svg = picture(state, "home", "ren");
  assert.ok(svg.includes("アキ"));
  assert.ok(
    !svg.includes("レン"),
    "Selecting a traveler must not teleport them into the base illustration",
  );
  state.residents[1].location = "home";
  svg = picture(state);
  assert.ok(svg.includes("ミオ"));
  assert.ok(!svg.includes("レン"));
  const standing = artwork(svg);
  state.residents[1].hp = 0;
  state.residents[1].wounds.body = 2;
  assert.notEqual(
    artwork(picture(state)),
    standing,
    "An unconscious person is shown lying down rather than continuing to stand",
  );
  assert.match(
    describeLandscape(state, state.residents[0]).description,
    /ミオの体力0、意識なし、傷が残っている/,
  );
});

test("A personal carving travels with its author until display and then remains in the actual shelf room", () => {
  let state = complete(createGame(126), "decorate");
  state = complete(state, "hobby");
  const travel = (next: LocationId) => {
    const result = command(state, {
      type: "assign",
      residentIds: ["aki"],
      kind: "move",
      target: next,
    });
    assert.equal(result.error, undefined);
    state = advance(result.state, result.state.residents[0].action!.duration);
  };
  travel("bedroom");
  assert.doesNotMatch(
    describeLandscape(state, state.residents[0], "home").description,
    /木彫りが完成|木彫りを棚に展示/,
  );
  assert.match(
    describeLandscape(state, state.residents[0]).description,
    /アキの小鳥の木彫りが完成（まだ手元/,
  );
  assert.doesNotMatch(
    describeLandscape(state, state.residents[0]).description,
    /窓辺に手作りの棚/,
  );
  travel("home");
  state = complete(state, "place-craft");
  travel("bedroom");
  const before = serialize(state);
  assert.match(
    describeLandscape(state, state.residents[0], "home").description,
    /アキの小鳥の木彫りを棚に展示/,
  );
  assert.doesNotMatch(
    describeLandscape(state, state.residents[0]).description,
    /木彫りが完成|木彫りを棚に展示/,
  );
  picture(state, "home");
  picture(state, "bedroom");
  assert.equal(serialize(state), before);
});

test("New artwork has its own shape and completed improvements only appear in their actual room", () => {
  const initial = createGame(126);
  initial.resources.scrap = 10;
  let state = complete(initial, "project", "wood-flower");
  assert.match(
    describeLandscape(state, state.residents[0]).description,
    /アキの木彫りの花が完成/,
  );
  assert.match(picture(state), /flower-carving/);
  assert.notEqual(
    artwork(picture(state)),
    artwork(picture(complete(createGame(126), "hobby"))),
  );
  state = complete(state, "project", "kitchen-tools");
  assert.match(picture(state), /local-kitchen-tools/);
  assert.match(
    describeLandscape(state, state.residents[0]).description,
    /アキが整えた料理道具/,
  );
  const moving = command(state, {
    type: "assign",
    residentIds: ["aki"],
    kind: "move",
    target: "kitchen",
  });
  assert.equal(moving.error, undefined);
  state = advance(moving.state, moving.state.residents[0].action!.duration);
  state = complete(state, "project", "rest-corner");
  const before = serialize(state);
  assert.match(picture(state, "home"), /local-kitchen-tools/);
  assert.doesNotMatch(picture(state, "home"), /local-rest-corner/);
  assert.match(picture(state, "kitchen"), /local-rest-corner/);
  assert.doesNotMatch(picture(state, "kitchen"), /local-kitchen-tools/);
  assert.equal(serialize(state), before);
});

test("The merchant cart appears at the real home entrance only during an actual visit", () => {
  const upcoming = createGame(126);
  assert.doesNotMatch(picture(upcoming), /merchant-cart/);
  const state = createGame(126);
  state.minutes = 2160;
  state.trade = {
    version: 1,
    nextArrival: 3600,
    receipts: [],
    visit: {
      id: 2160,
      arrivesAt: 2160,
      leavesAt: 2400,
      status: "open",
      stock: { scrap: 3, medicine: 1 },
    },
  };
  deserialize(serialize(state));
  const before = serialize(state);
  assert.match(picture(state), /merchant-cart/);
  assert.match(
    describeLandscape(state, state.residents[0]).description,
    /行商の荷車.*16:00まで/,
  );
  assert.doesNotMatch(picture(state, "bedroom"), /merchant-cart/);
  assert.equal(serialize(state), before);
  state.residents[2].location = "road";
  const away = serialize(state);
  assert.match(picture(state, "home", "ren"), /merchant-cart/);
  assert.equal(serialize(state), away);
  state.minutes = 2400;
  state.trade.visit!.status = "departed";
  deserialize(serialize(state));
  const departed = serialize(state);
  assert.doesNotMatch(picture(state), /merchant-cart/);
  assert.doesNotMatch(
    describeLandscape(state, state.residents[0]).description,
    /行商の荷車/,
  );
  assert.equal(serialize(state), departed);
});

test("A stove burns only in the cooking room, while the house chimney reflects indoor cooking", () => {
  let state = createGame(126);
  state.residents[1].location = "bedroom";
  state = command(state, {
    type: "assign",
    residentIds: ["mio"],
    kind: "cook",
  }).state;
  const before = serialize(state);
  assert.match(picture(state, "home"), /cooking-smoke/);
  assert.match(picture(state, "kitchen"), /stove-idle/);
  assert.doesNotMatch(picture(state, "kitchen"), /stove-cooking/);
  assert.match(
    describeLandscape(state, state.residents[0], "kitchen").description,
    /ミオが寝床と私室で料理中/,
  );
  assert.equal(serialize(state), before);
  const outdoor = createGame(126);
  outdoor.residents[1].location = "garden";
  const cookingOutside = command(outdoor, {
    type: "assign",
    residentIds: ["mio"],
    kind: "cook",
  }).state;
  assert.doesNotMatch(picture(cookingOutside, "home"), /cooking-smoke/);
});

test("The guard illustration follows the shared enemy location rather than a fixed ruins scene", () => {
  const state = createGame(126);
  state.enemy.location = "road";
  const before = serialize(state);
  assert.match(picture(state, "road"), /guard-present/);
  assert.doesNotMatch(picture(state, "ruins"), /guard-present|guard-retreated/);
  assert.match(
    describeLandscape(state, state.residents[0], "road").description,
    /この場所に流れ者がいる/,
  );
  assert.doesNotMatch(
    describeLandscape(state, state.residents[0], "ruins").description,
    /流れ者が物資を守っている/,
  );
  assert.equal(serialize(state), before);
});
