import test from "node:test";
import assert from "node:assert/strict";
import {
  applyProject,
  dayWorld,
  defaultWorldConfig,
  generateWorld,
  isWorld,
  isWorldConfig,
  places,
  projectInfo,
  travelMinutes,
} from "../src/reform/world";

test("world seeds reproduce routes and let a town keep its coordinates across regenerated terrain", () => {
  const config = defaultWorldConfig();
  const original = generateWorld(config);
  const copy = generateWorld(JSON.parse(JSON.stringify(config)));
  assert.deepEqual(copy, original);
  const rerolled = generateWorld({
    ...config,
    seed: 65004,
    pinnedTownSeed: config.seed,
  });
  const anchor = (w: typeof original) => [w.sites[0].x, w.sites[0].y];
  assert.deepEqual(anchor(original), anchor(rerolled));
  assert.notDeepEqual(
    original.sites.find((s) => s.id === "forest"),
    rerolled.sites.find((s) => s.id === "forest"),
  );
  for (const site of rerolled.sites)
    assert.equal(site.market, travelMinutes(rerolled, site.id, "village"));
});

test("required, optional and weighted placements obey their town distance, including new visitable settlements", () => {
  const cfg = defaultWorldConfig();
  const [template] = cfg.rules;
  cfg.woods = 3;
  cfg.rules = [
    { ...template, id: "institution", reach: 0, anchor: "mill" },
    { ...template, id: "office", required: false },
    { ...template, id: "hamlet", kind: "village", name: "待雪の村", reach: 75 },
  ];
  let present = 0;
  const towns = new Set<string>();
  for (let seed = 1; seed <= 128; seed++) {
    const w = generateWorld({ ...cfg, seed });
    assert.ok(isWorld(w));
    assert.equal(
      w.landmarks.find((l) => l.id === "institution")?.placeId,
      "mill",
    );
    assert.equal(new Set(places(w).map((s) => s.id)).size, places(w).length);
    const village = w.landmarks.find((l) => l.id === "hamlet")!;
    assert.ok(travelMinutes(w, village.placeId, village.anchor) <= 75);
    assert.ok(places(w).some((s) => s.name === "待雪の村"));
    const site = w.sites.find((s) => s.id === village.placeId)!;
    towns.add(site.x + "," + site.y);
    if (w.landmarks.some((l) => l.id === "office")) present++;
  }
  assert.ok(present > 0 && present < 128);
  assert.ok(towns.size > 5);
  const warm = generateWorld({ ...cfg, climate: "warm" }),
    cold = generateWorld({ ...cfg, climate: "cool" });
  assert.ok(
    warm.sites.find((s) => s.id === "pass")!.frost >
      cold.sites.find((s) => s.id === "pass")!.frost,
  );
});

test("building a bridge gives a shorter journey immediately; next dawn a merchant actually reroutes", () => {
  const w = generateWorld(defaultWorldConfig());
  dayWorld(w);
  const prior = structuredClone(w);
  const before = travelMinutes(w, "village", "mill");
  assert.ok(projectInfo(w, "bridge")?.allowed);
  applyProject(w, "bridge");
  assert.equal(projectInfo(w, "bridge")?.allowed, false);
  assert.ok(travelMinutes(w, "village", "mill") < before);
  assert.deepEqual(w.trade.road, prior.trade.road);
  dayWorld(w);
  dayWorld(prior);
  assert.deepEqual(w.trade.road, ["mill", "village"]);
  assert.ok(prior.trade.road.includes("landing"));
  assert.equal(w.trade.ferry, prior.trade.ferry - 1);
  assert.ok(w.trade.bridge > 0);
  assert.ok(w.trade.stock > prior.trade.stock);
  assert.ok(isWorld(JSON.parse(JSON.stringify(w))));
});

test("regional support needs separate visits on different days before it changes building or supply", () => {
  const config = defaultWorldConfig();
  config.rules[0].kind = "facility";
  const w = generateWorld(config);
  assert.equal(projectInfo(w, "bridge")?.wood, 4);
  applyProject(w, "negotiate");
  applyProject(w, "visit:apothecary");
  assert.equal(w.landmarks[0].trust, 1);
  dayWorld(w);
  applyProject(w, "visit:apothecary");
  assert.equal(w.landmarks[0].trust, 2);
  assert.equal(projectInfo(w, "bridge")?.wood, 3);
  const before = w.trade.stock;
  applyProject(w, "deliver");
  applyProject(w, "deliver");
  assert.equal(w.trade.stock, before + 2);
  assert.equal(w.trade.deliveries, 1);
  assert.ok(isWorld(w));
});

test("save data rejects corrupt geography, non-numeric quantities and duplicate rules", () => {
  const w = generateWorld(defaultWorldConfig());
  assert.ok(isWorld(w));
  assert.equal(
    isWorldConfig({
      ...w.config,
      rules: [w.config.rules[0], w.config.rules[0]],
    }),
    false,
  );
  assert.equal(isWorld({ ...w, trade: { ...w.trade, day: "7" } }), false);
  assert.equal(isWorld({ ...w, sites: w.sites.slice(1) }), false);
  assert.equal(
    isWorld({ ...w, sites: w.sites.map((s) => ({ ...s, market: -9 })) }),
    false,
  );
  assert.equal(
    isWorld({
      ...w,
      trade: { ...w.trade, road: ["mill", "bad-id", "village"] },
    }),
    false,
  );
});
