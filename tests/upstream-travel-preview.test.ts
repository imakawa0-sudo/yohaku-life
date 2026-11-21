import test from "node:test";
import assert from "node:assert/strict";
import { command, createGame, inspectTravelRoute } from "../src/game/engine";

test("集落と舟宿の直接移動の危険と迂回の所要が実際の予約に一致する", () => {
  const game = createGame();
  for (const target of ["village", "lodge"] as const) {
    const direct = inspectTravelRoute(game, "aki", target)!;
    const detour = inspectTravelRoute(game, "aki", target, true)!;
    assert.equal(direct.path.includes("ruins"), target === "village");
    assert.ok(!detour.path.includes("ruins"));
    assert.equal(detour.minutes > direct.minutes, target === "village");
    for (const route of [direct, detour]) {
      const result = command(game, { type: "assign", kind: "move", residentIds: ["aki"], target,
        ...(route === detour ? { via: route.path.slice(0, -1) } : {}) });
      assert.equal(result.error, undefined);
      assert.equal(result.state.minutes, game.minutes);
      assert.deepEqual(result.state.residents[0].action?.path, route.path);
      assert.equal(result.state.residents[0].action?.duration, route.minutes);
    }
  }
  assert.equal(game.residents[0].action, null);
});
