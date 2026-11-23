import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { characterRaster } from "../src/reform/characterArt";
import type { CharacterRaster } from "../src/reform/characterArt";
import { appearanceOptions } from "../src/reform/peopleModel";
import type { Appearance } from "../src/reform/peopleModel";

const kinds = ["portrait", "walker"] as const;
const counts: Record<keyof Appearance, number> = {
  face: 3,
  skin: 5,
  hair: 5,
  hairColor: 5,
  age: 3,
  build: 3,
  eyes: 3,
  mark: 4,
  clothing: 4,
  dye: 6,
};
const keys = Object.keys(counts) as (keyof Appearance)[];
const base: Appearance = Object.freeze({
  face: "oval",
  skin: "ivory",
  hair: "crop",
  hairColor: "ink",
  age: "young",
  build: "medium",
  eyes: "soft",
  mark: "none",
  clothing: "shirt",
  dye: "moss",
});

function signature(raster: CharacterRaster) {
  const bytes = Buffer.from(
    raster.pixels.buffer,
    raster.pixels.byteOffset,
    raster.pixels.byteLength,
  );
  return (
    `${raster.width}x${raster.height}:` +
    createHash("sha256").update(bytes).digest("hex")
  );
}
function render(a: Appearance) {
  return {
    portrait: signature(characterRaster(a, "portrait")),
    walker: signature(characterRaster(a, "walker")),
  };
}
function assertDifferent(
  actual: ReturnType<typeof render>,
  expected: ReturnType<typeof render>,
  label: string,
) {
  for (const kind of kinds)
    assert.notEqual(actual[kind], expected[kind], `${label}: ${kind}`);
}

test("All ten appearance fields retain their 41 choices and distinguish both raster kinds without mutating input", () => {
  assert.deepEqual(Object.keys(appearanceOptions).sort(), [...keys].sort());
  assert.equal(
    Object.values(counts).reduce((sum, count) => sum + count, 0),
    41,
  );
  const original = render(base);
  for (const key of keys) {
    const choices = Object.keys(appearanceOptions[key]);
    assert.equal(choices.length, counts[key], key);
    const seen = {
      portrait: new Map<string, string>(),
      walker: new Map<string, string>(),
    };
    for (const value of choices) {
      const a = Object.freeze({ ...base, [key]: value });
      const before = { ...a };
      for (const kind of kinds) {
        const raster = characterRaster(a, kind);
        assert.deepEqual(
          [raster.width, raster.height],
          kind === "portrait" ? [48, 56] : [26, 60],
          `${key}=${value}: native ${kind} dimensions`,
        );
        assert.equal(raster.pixels.length, raster.width * raster.height);
        assert.ok(
          raster.pixels.some((pixel) => pixel >>> 24 === 255),
          "Visible character pixels",
        );
        assert.ok(
          raster.pixels.some((pixel) => pixel === 0),
          "Transparent surround",
        );
        const hash = signature(raster);
        assert.ok(
          !seen[kind].has(hash),
          `${key}=${value} collides with ${seen[kind].get(hash)} in ${kind}`,
        );
        seen[kind].set(hash, value);
      }
      assert.deepEqual(
        a,
        before,
        `${key}=${value}: renderer leaves every input field unchanged`,
      );
      for (const other of keys)
        if (other !== key) assert.equal(a[other], base[other]);
    }
    assert.deepEqual(
      render(base),
      original,
      `${key}: returning to the original appearance is stable`,
    );
  }
});

test("Composite appearances render by their values, independently of names, IDs, property order or object identity", () => {
  const appearances: Appearance[] = [
    base,
    {
      face: "angular",
      skin: "umber",
      hair: "braid",
      hairColor: "silver",
      age: "elder",
      build: "broad",
      eyes: "straight",
      mark: "scar",
      clothing: "coat",
      dye: "flax",
    },
    {
      face: "round",
      skin: "wheat",
      hair: "wave",
      hairColor: "honey",
      age: "adult",
      build: "slight",
      eyes: "open",
      mark: "glasses",
      clothing: "apron",
      dye: "plum",
    },
  ];
  const seen = { portrait: new Set<string>(), walker: new Set<string>() };
  for (const appearance of appearances) {
    // Extra metadata must never become a lookup for a preselected character.
    const named = Object.freeze({
      ...appearance,
      id: "person-1",
      name: "カヤ",
    });
    const renamed = Object.freeze({
      dye: appearance.dye,
      clothing: appearance.clothing,
      mark: appearance.mark,
      eyes: appearance.eyes,
      build: appearance.build,
      age: appearance.age,
      hairColor: appearance.hairColor,
      hair: appearance.hair,
      skin: appearance.skin,
      face: appearance.face,
      id: "different-person",
      name: "同じ名前",
    });
    const before = { ...named };
    const expected = render(named);
    assert.deepEqual(render(renamed), expected);
    assert.deepEqual(render({ ...appearance }), expected);
    assert.deepEqual(named, before);
    for (const kind of kinds) {
      assert.ok(
        !seen[kind].has(expected[kind]),
        `Different composite with the same name/ID: ${kind}`,
      );
      seen[kind].add(expected[kind]);
    }
  }
  // Reusing an editor object must not reuse a raster for its previous values.
  const draft = { ...base };
  const initial = render(draft);
  draft.eyes = "open";
  assertDifferent(render(draft), initial, "Editing the same appearance object");
  draft.eyes = base.eyes;
  assert.deepEqual(render(draft), initial);
});

test("All three eye shapes remain distinct under every hairstyle, with glasses and at every age", () => {
  // Focused overlap cases, not an enumeration of every appearance combination.
  for (const hair of Object.keys(
    appearanceOptions.hair,
  ) as Appearance["hair"][]) {
    for (const mark of ["none", "glasses"] as const) {
      for (const age of Object.keys(
        appearanceOptions.age,
      ) as Appearance["age"][]) {
        const seen = { portrait: new Set<string>(), walker: new Set<string>() };
        for (const eyes of Object.keys(
          appearanceOptions.eyes,
        ) as Appearance["eyes"][]) {
          const rendered = render(
            Object.freeze({ ...base, hair, mark, age, eyes }),
          );
          for (const kind of kinds) {
            assert.ok(
              !seen[kind].has(rendered[kind]),
              `${hair}/${mark}/${age}/${eyes}: eye shape hidden in ${kind}`,
            );
            seen[kind].add(rendered[kind]);
          }
        }
      }
    }
  }
});

test("Interleaving both raster kinds and many appearances leaves prior results and cache revisits stable", () => {
  const retained = {
    portrait: characterRaster(base, "portrait"),
    walker: characterRaster(base, "walker"),
  };
  const expected = render(base);
  // 150 distinct appearance inputs exercise cache turnover without depending
  // on its internal eviction strategy or requiring shared object identities.
  for (const hair of Object.keys(
    appearanceOptions.hair,
  ) as Appearance["hair"][]) {
    for (const skin of Object.keys(
      appearanceOptions.skin,
    ) as Appearance["skin"][]) {
      for (const dye of Object.keys(
        appearanceOptions.dye,
      ) as Appearance["dye"][]) {
        render(Object.freeze({ ...base, hair, skin, dye }));
      }
    }
  }
  assert.deepEqual(render({ ...base }), expected);
  for (const kind of kinds) {
    assert.equal(
      signature(retained[kind]),
      expected[kind],
      `Other renders must not overwrite an earlier ${kind} buffer`,
    );
  }
});
