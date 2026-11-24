import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  advance,
  order,
  isGame,
  setHousingPassage,
  setHousingRoomAccess,
} from "@reform/sim";
import { importSlot } from "@reform/library";
import { editHouse } from "@reform/house";
import { applyHousingHouseEdit } from "@reform/housing/runtime";
import {
  createRoomConstruction,
  reserveConstructionMaterial,
  assignConstructionHaul,
  assignConstructionBuild,
} from "@reform/housing/construction";

const stable = (v: any) => JSON.parse(JSON.stringify(v));
const hash = (v: string | Buffer) =>
  createHash("sha256").update(v).digest("hex");
const okay = (r: any) => {
  assert.equal(r.error, undefined);
  return r.game;
};
const run = (g: any, op: any) => {
  switch (op.type) {
    case "order":
      return order(g, op.actor, op.kind, op.target);
    case "advance":
      return advance(g, op.minutes);
    case "plan":
      return okay(createRoomConstruction(g, op.input));
    case "reserve":
      return okay(reserveConstructionMaterial(g, op.id));
    case "haul":
      return okay(assignConstructionHaul(g, op.id, op.actor, op.direction));
    case "build":
      return okay(assignConstructionBuild(g, op.id, op.actor));
    case "edit":
      return okay(applyHousingHouseEdit(g, editHouse(g.house, op.edit)));
    case "passage":
      return setHousingPassage(g, op.kind, op.id, op.open);
    case "access":
      return setHousingRoomAccess(g, op.room, op.allowed);
    default:
      throw new Error("Unknown operation " + op.type);
  }
};
const manifest = JSON.parse(readFileSync(process.argv[2], "utf8"));
const report: any = {
  sourceCommit: manifest.sourceCommit,
  branches: [],
  bytePairs: [],
};
for (const branch of manifest.branches) {
  const start = importSlot(readFileSync(branch.sourceFile, "utf8"));
  let g = structuredClone(branch.fromOrigin ? start.origin : start.game);
  const origin = structuredClone(start.origin);
  const checks = [];
  for (const checkpoint of branch.checkpoints) {
    for (const op of checkpoint.operations ?? []) g = run(g, op);
    assert.ok(isGame(g), branch.name + " expected valid");
    const bytes = readFileSync(checkpoint.file);
    const actual = importSlot(bytes.toString("utf8"));
    assert.deepEqual(
      stable(actual.game),
      stable(g),
      branch.name + ": " + checkpoint.name + " Game",
    );
    assert.deepEqual(
      stable(actual.origin),
      stable(origin),
      branch.name + ": " + checkpoint.name + " origin",
    );
    checks.push({
      name: checkpoint.name,
      htmlSha256: checkpoint.htmlSha256,
      time: g.time,
      bytes: bytes.length,
      sha256: hash(bytes),
      gameSha256: hash(JSON.stringify(actual.game)),
      originSha256: hash(JSON.stringify(actual.origin)),
      gameMatches: true,
      originMatches: true,
      stock: {
        wood: g.wood,
        food: g.food,
        ingredients: g.ingredients,
        coins: g.coins,
      },
      tasks: g.actors.map((a: any) => ({
        id: a.person.id,
        kind: a.task?.kind ?? null,
        target: a.task?.target,
        station: a.task?.station,
        remaining: a.task?.remaining,
      })),
    });
  }
  report.branches.push({ name: branch.name, checks });
}
for (const p of manifest.bytePairs ?? []) {
  const a = readFileSync(p.first),
    b = readFileSync(p.second);
  assert.deepEqual(a, b, p.name);
  report.bytePairs.push({
    name: p.name,
    identical: true,
    bytes: a.length,
    sha256: hash(a),
  });
}
report.exportCount = report.branches.reduce(
  (n: number, b: any) => n + b.checks.length,
  0,
);
writeFileSync(process.argv[3], JSON.stringify(report, null, 2) + "\n");
console.log(
  JSON.stringify(
    {
      exportCount: report.exportCount,
      branches: report.branches.map((b: any) => ({
        name: b.name,
        checks: b.checks.length,
      })),
      bytePairs: report.bytePairs.length,
      allMatched: true,
    },
    null,
    2,
  ),
);
