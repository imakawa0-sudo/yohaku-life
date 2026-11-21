import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { VillageArtPanel } from "../src/components/VillageArtPanel";
import { command, createGame, serialize } from "../src/game/engine";
import { finishCraft } from "../src/game/life";
import type { GameState } from "../src/game/types";

function shelf(game: GameState, actorId: string) {
  const before = serialize(game);
  const html = renderToStaticMarkup(createElement(VillageArtPanel, {
    game, actor: game.residents.find(person => person.id === actorId),
    onCommand: () => assert.fail("Reading the shelf issued a command"),
  }));
  assert.equal(serialize(game), before);
  return html;
}

test("The shop shelf shows another maker's object to visitors while keeping the reply with its author", () => {
  let game = createGame(138);
  const author = game.residents.find(person => person.id === "aki")!;
  const carving = finishCraft(game, author, game.nextId++);
  author.location = "village";
  game.residents.find(person => person.id === "mio")!.location = "village";
  const exhibit = command(game, { type: "exhibit-village-art", residentId: "aki", craftId: carving.id });
  assert.ifError(exhibit.error);
  game = exhibit.state;
  game.minutes += 1440;
  const reply = command(game, { type: "hear-village-art", residentId: "aki" });
  assert.ifError(reply.error);
  game = reply.state;
  const visitor = shelf(game, "mio");
  assert.match(visitor, /<details[^>]* open/);
  assert.match(visitor, /アキの「小鳥の木彫り」/);
  assert.doesNotMatch(visitor, /商い手は木彫りを少し回した/);
  assert.match(shelf(game, "aki"), /商い手は木彫りを少し回した/);
});

test("The confirmation names the selected piece and identical titles have distinct options", () => {
  const game = createGame(138);
  const author = game.residents.find(person => person.id === "aki")!;
  finishCraft(game, author, game.nextId++);
  const single = shelf(game, author.id);
  assert.match(single, /「小鳥の木彫り」は、預けると集落に残ります。/);
  game.minutes += 30;
  finishCraft(game, author, game.nextId++);
  const options = [...shelf(game, author.id).matchAll(/<option [^>]*>(小鳥の木彫り[^<]*)<\/option>/g)];
  assert.equal(options.length, 2);
  assert.notEqual(options[0][1], options[1][1]);
});
