import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Landscape, describeLandscape } from "../src/components/Landscape.tsx";
import App from "../src/App.tsx";
import { advance, command, createGame, serialize } from "../src/game/engine.ts";
import type { GameState, LocationId, ProjectUpgrade } from "../src/game/types.ts";

function picture(state: GameState, location: LocationId) {
  return renderToStaticMarkup(createElement(Landscape, {
    game: state, resident: state.residents[0], location,
  }));
}

test("A saved workbench is visible only in its actual base room without changing any saved facts", () => {
  for (const location of ["home", "kitchen", "bedroom", "garden"] as const) {
    const state = createGame(481);
    state.life!.upgrades = [{
      id: state.nextId++, recipeId: "crafting-tools", creatorId: "aki", location, completedAt: state.minutes,
    }];
    const before = serialize(state);
    for (const view of ["home", "kitchen", "bedroom", "garden", "road", "ruins"] as const) {
      const image = picture(state, view);
      const description = describeLandscape(state, state.residents[0], view).description;
      if (view === location) {
        assert.match(image, /data-detail="local-crafting-tools"/);
        assert.match(description, /アキが整えた手仕事台/);
        assert.match(description, /新しく始める小鳥・花・設備制作/);
      } else {
        assert.doesNotMatch(image, /data-detail="local-crafting-tools"/);
        assert.doesNotMatch(description, /が整えた手仕事台/);
      }
    }
    assert.equal(serialize(state), before);
  }
});

test("Cooking tools, a rest corner and a workbench keep distinct artwork and explanations in the same room", () => {
  const state = createGame(482);
  state.life!.upgrades = (["kitchen-tools", "rest-corner", "crafting-tools"] as ProjectUpgrade["recipeId"][])
    .map(recipeId => ({ id: state.nextId++, recipeId, creatorId: "aki", location: "home", completedAt: state.minutes }));
  const before = serialize(state);
  const image = picture(state, "home");
  const description = describeLandscape(state, state.residents[0], "home").description;
  for (const detail of ["local-kitchen-tools", "local-rest-corner", "local-crafting-tools"])
    assert.equal(image.split(`data-detail="${detail}"`).length - 1, 1);
  assert.match(description, /整えた料理道具/);
  assert.equal(description.split("整えた静かな休憩場所").length - 1, 1);
  assert.equal(description.split("整えた手仕事台").length - 1, 1);
  assert.equal(serialize(state), before);
});

test("A workbench keeps its full description behind a short caption while existing status and cooking take priority", () => {
  const state = createGame(485);
  state.life!.upgrades = [{
    id: state.nextId++, recipeId: "crafting-tools", creatorId: "aki", location: "home", completedAt: state.minutes,
  }];
  const idle = describeLandscape(state, state.residents[0]);
  assert.equal(idle.caption, "朝の光 · 手仕事台あり");
  assert.match(idle.description, /アキが整えた手仕事台があり、この場所で新しく始める小鳥・花・設備制作が早くなる/);
  const cooking = command(state, { type: "assign", residentIds: ["mio"], kind: "cook" });
  assert.equal(cooking.error, undefined);
  assert.equal(describeLandscape(cooking.state, cooking.state.residents[0]).caption, "朝の光 · ミオが料理中");
  state.residents[0].hp = 80;
  const before = serialize(state);
  assert.equal(describeLandscape(state, state.residents[0]).caption, "朝の光 · アキは体力低下");
  assert.match(picture(state, "home"), /新しく始める小鳥・花・設備制作が早くなる/);
  assert.equal(serialize(state), before);
});

test("An actual unfinished installation does not become scenery until its work completes", () => {
  const start = createGame(483);
  for (const person of start.residents) person.policy = "rest";
  const result = command(start, { type: "assign", residentIds: ["aki"], kind: "project", target: "crafting-tools" });
  assert.equal(result.error, undefined);
  const during = result.state;
  const job = during.residents[0].action!;
  assert.equal(job.kind, "project");
  assert.doesNotMatch(picture(during, "home"), /data-detail="local-crafting-tools"/);
  assert.doesNotMatch(describeLandscape(during, during.residents[0]).description, /が整えた手仕事台/);
  const finished = advance(during, job.duration);
  assert.equal(finished.life!.upgrades?.some(upgrade => upgrade.id === job.id && upgrade.recipeId === "crafting-tools"), true);
  assert.match(picture(finished, "home"), /data-detail="local-crafting-tools"/);
  assert.match(describeLandscape(finished, finished.residents[0]).description, /が整えた手仕事台/);
});

function renderHome(state: GameState) {
  const raw = serialize(state);
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  let writes = 0;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { getItem: (key: string) => key === "yohaku-autosave-v1" ? raw : null, setItem: () => { writes++; } },
  });
  try {
    const html = renderToStaticMarkup(createElement(App));
    assert.equal(writes, 0);
    assert.equal(serialize(state), raw);
    return html;
  } finally {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
}

test("Only a work's saved tool marker explains its active or held duration, never current furniture alone", () => {
  let state = createGame(484);
  for (const person of state.residents) person.policy = "rest";
  const act = (cmd: Parameters<typeof command>[1]) => {
    const result = command(state, cmd);
    assert.equal(result.error, undefined, result.error);
    state = result.state;
  };
  const workSection = (html: string, kind: "running" | "suspended") => {
    const section = html.match(new RegExp(`<div class="current-action ${kind}-work">([\\s\\S]*?)<div class="work-controls">`));
    assert.ok(section, `Missing ${kind} work`);
    return section[1];
  };
  act({ type: "assign", residentIds: ["aki"], kind: "hobby" });
  state = advance(state, 5);
  act({ type: "pause", residentId: "aki" });
  const oldId = state.residents[0].suspended!.id;
  act({ type: "assign", residentIds: ["mio"], kind: "project", target: "crafting-tools" });
  state = advance(state, state.residents.find(person => person.id === "mio")!.action!.duration);
  assert.ok(state.life!.upgrades?.some(upgrade => upgrade.recipeId === "crafting-tools"));
  assert.equal(state.residents[0].suspended!.craftingToolsId, undefined);
  assert.doesNotMatch(workSection(renderHome(state), "suspended"), /開始時の手仕事台を反映/);
  act({ type: "assign", residentIds: ["aki"], kind: "hobby" });
  assert.ok(state.residents[0].action!.craftingToolsId);
  const both = renderHome(state);
  assert.match(workSection(both, "running"), /開始時の手仕事台を反映/);
  assert.doesNotMatch(workSection(both, "suspended"), /開始時の手仕事台を反映/);
  act({ type: "cancel", residentId: "aki", actionId: oldId });
  act({ type: "pause", residentId: "aki" });
  assert.match(workSection(renderHome(state), "suspended"), /開始時の手仕事台を反映/);
});
