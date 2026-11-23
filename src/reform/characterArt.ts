import atlas from "./art/characters/layers.json";
import type { Appearance } from "./peopleModel";

/** Source layers compose all ten appearance values. Names/IDs never select art. */
export const characterArtVersion = "chatgpt-parts-20261123";
export const portraitWidth = 48;
export const portraitHeight = 56;
export const walkerWidth = 26;
export const walkerHeight = 60;
export interface CharacterRaster {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint32Array;
}
type Grid = CharacterRaster;
type Palette = Record<string, number>;
type Rows = readonly string[];
type Point = readonly [number, number];
const appearanceKeys: (keyof Appearance)[] = [
  "face",
  "skin",
  "hair",
  "hairColor",
  "age",
  "build",
  "eyes",
  "mark",
  "clothing",
  "dye",
];
const cache = new Map<string, CharacterRaster>();
const CACHE_LIMIT = 128;
const rgba = (hex: string) => (0xff000000 | parseInt(hex.slice(1), 16)) >>> 0;
const blank = (width: number, height: number): Grid => ({
  width,
  height,
  pixels: new Uint32Array(width * height),
});

function paletteFor(a: Appearance): Palette {
  const palettes: Record<string, readonly string[]> = {
    skin: atlas.palettes.skin[a.skin],
    hair: atlas.palettes.hair[a.hairColor],
    cloth: atlas.palettes.cloth[a.dye],
    linen: atlas.palettes.linen,
    trim: atlas.palettes.cloth.moss,
    trousers: atlas.palettes.trousers,
    leather: atlas.palettes.leather,
    ink: atlas.palettes.ink,
    white: atlas.palettes.white,
  };
  const result: Palette = {};
  for (const [role, chars] of Object.entries(atlas.alphabet))
    [...chars].forEach((char, i) => {
      result[char] = rgba(palettes[role][i]);
    });
  return result;
}
function dot(g: Grid, x: number, y: number, color: number) {
  if (x >= 0 && x < g.width && y >= 0 && y < g.height)
    g.pixels[y * g.width + x] = color;
}
function rect(
  g: Grid,
  x: number,
  y: number,
  w: number,
  h: number,
  color: number,
) {
  for (let row = y; row < y + h; row++)
    for (let col = x; col < x + w; col++) dot(g, col, row, color);
}
function polygon(g: Grid, color: number, points: readonly Point[]) {
  const min = Math.max(0, Math.floor(Math.min(...points.map((p) => p[1]))));
  const max = Math.min(
    g.height,
    Math.ceil(Math.max(...points.map((p) => p[1]))),
  );
  for (let y = min; y < max; y++) {
    const crossings: number[] = [];
    points.forEach(([x1, y1], i) => {
      const [x2, y2] = points[(i + 1) % points.length];
      if (y1 > y + 0.5 !== y2 > y + 0.5)
        crossings.push(x1 + ((y + 0.5 - y1) * (x2 - x1)) / (y2 - y1));
    });
    crossings.sort((a, b) => a - b);
    for (let i = 0; i + 1 < crossings.length; i += 2)
      for (
        let x = Math.ceil(crossings[i] - 0.5);
        x < Math.ceil(crossings[i + 1] - 0.5);
        x++
      )
        dot(g, x, y, color);
  }
}
function stamp(g: Grid, x: number, y: number, rows: Rows, p: Palette) {
  rows.forEach((row, j) =>
    [...row].forEach((char, i) => {
      if (p[char]) dot(g, x + i, y + j, p[char]);
    }),
  );
}
function layer(
  g: Grid,
  rows: Rows,
  p: Palette,
  scaleX = 1,
  centerX = 23.5,
  offsetY = 0,
) {
  for (
    let y = Math.max(0, offsetY);
    y < Math.min(rows.length + offsetY, g.height);
    y++
  )
    for (let x = 0; x < g.width; x++) {
      const sx = Math.round(centerX + (x - centerX) / scaleX);
      const value = p[rows[y - offsetY][sx]];
      if (value) dot(g, x, y, value);
    }
}

function hair(g: Grid, a: Appearance, p: Palette, front: boolean) {
  const rows = atlas.hair[a.hair];
  // Register at the eye line; the bun and braid keep their extra extent.
  for (let y = 0; y < g.height; y++)
    for (let x = 0; x < g.width; x++) {
      const sx = a.hair === "wave" ? Math.round((x - 27) / 1.12 + 29) : x;
      const sy =
        a.hair === "wave"
          ? Math.round(y < 22 ? (y - 22) / 1.18 + 19 : y - 3)
          : a.hair === "braid"
            ? y - 1
            : y;
      const value = p[rows[sy]?.[sx]];
      // The long-haired master has a narrower face than the common face parts.
      // Register its inner hair edge to both eyes, not just its outer silhouette.
      const eyeOpening =
        a.hair === "wave" &&
        ((y >= 20 && y <= 27 && x >= 22 && x <= 38) ||
          (y >= 18 && y < 20 && x >= 25 && x <= 37));
      const belongsToFront =
        y < 34 || x < 18 || (a.hair === "wave" && x > 34) || a.hair === "braid";
      if (value && !eyeOpening && belongsToFront === front) dot(g, x, y, value);
    }
}
function face(
  g: Grid,
  a: Appearance,
  p: Palette,
  withNeck = false,
  features = true,
) {
  // Fill only the forehead hidden by the source hairstyle before composing.
  if (withNeck)
    polygon(g, p.g, [
      [20, 33],
      [32, 33],
      [31, 41],
      [26, 45],
      [19, 40],
    ]);
  polygon(g, p.h, [
    [20, 7],
    [30, 6],
    [36, 10],
    [39, 17],
    [39, 28],
    [35, 30],
    [20, 30],
    [16, 25],
    [15, 19],
    [17, 12],
  ]);
  polygon(g, p.f, [
    [17, 12],
    [20, 9],
    [20, 28],
    [17, 26],
    [15, 19],
  ]);
  layer(g, atlas.faces[a.face], p);
  // Noses, mouths and jaw shapes retain their source pixels. Native feature
  // stamps keep eye/age/mark choices independent and legible at game size.
  rect(g, 22, 18, 16, 7, p.h);
  if (!features) return;
  rect(g, 23, 19, 5, 1, p.j);
  rect(g, 34, 19, 4, 1, p.j);
  const eyes = {
    soft: [
      ["888.", "988."],
      ["88.", "98."],
    ],
    open: [
      [".88.", "9888", ".88."],
      [".88", "988", ".88"],
    ],
    straight: [
      ["8888", "..8."],
      ["888", ".8."],
    ],
  }[a.eyes];
  stamp(g, 23, 22, eyes[0], p);
  stamp(g, 34, 22, eyes[1], p);
  if (a.eyes === "straight") {
    dot(g, 27, 20, p.j);
    dot(g, 33, 20, p.j);
  }
  if (a.age === "adult") {
    stamp(g, 23, 26, ["ee", ".f"], p);
    dot(g, 35, 26, p.e);
  } else if (a.age === "elder") {
    stamp(g, 21, 25, ["cd...", ".ed..", "..e.."], p);
    stamp(g, 35, 25, ["dc", "ed"], p);
    stamp(g, 22, 30, ["d....d", ".e..e.", "..ee.."], p);
    rect(g, 27, 17, 5, 1, p.e);
  }
  if (a.mark === "freckles") {
    for (const [x, y] of [
      [21, 27],
      [23, 28],
      [25, 27],
      [35, 27],
      [37, 26],
    ])
      dot(g, x, y, p.c);
  } else if (a.mark === "scar") {
    stamp(g, 20, 26, ["c..", "gc.", ".gc"], p);
  } else if (a.mark === "glasses") {
    const glasses = { f: rgba("#655546"), l: rgba("#c7b18d") };
    stamp(
      g,
      21,
      20,
      [
        "..ffff..",
        ".f....f.",
        "f......f",
        "f......f",
        "f......f",
        ".f....f.",
        "..ffff..",
      ],
      glasses,
    );
    stamp(
      g,
      32,
      20,
      [".ffff.", "f....f", "f....f", "f....f", "f....f", ".ffff."],
      glasses,
    );
    rect(g, 29, 22, 3, 1, glasses.f);
    rect(g, 18, 22, 3, 1, glasses.f);
    dot(g, 24, 20, glasses.l);
    dot(g, 34, 20, glasses.l);
  }
}
function portrait(a: Appearance, p: Palette): Grid {
  const g = blank(portraitWidth, portraitHeight);
  hair(g, a, p, false);
  layer(
    g,
    atlas.clothes[a.clothing],
    p,
    { slight: 1, medium: 1.1, broad: 1.22 }[a.build],
    23.5,
    3,
  );
  face(g, a, p);
  hair(g, a, p, true);
  return g;
}
function outfit(g: Grid, a: Appearance, p: Palette, rows: Rows) {
  if (a.clothing === "wrap") return;
  const spread = a.build === "broad" ? 1 : a.build === "slight" ? -1 : 0;
  // Replace the wrap trim before another garment is composed. Keep source
  // arms, relaxed pose, trousers and boots in every outfit.
  for (let y = 14; y < 37; y++)
    for (let x = 0; x < g.width; x++) {
      const sx = a.build === "slight" ? Math.round(13 + (x - 13) / 0.88) : x;
      const char = rows[y]?.[sx];
      if (
        char &&
        (atlas.alphabet.trim + atlas.alphabet.linen).includes(char) &&
        g.pixels[y * g.width + x]
      )
        dot(g, x, y, p.t);
    }
  if (a.clothing === "coat") {
    polygon(g, p.q, [
      [8 - spread, 26],
      [18 + spread, 26],
      [20 + spread, 39],
      [17, 43],
      [13, 39],
      [8, 43],
      [5 - spread, 40],
    ]);
    polygon(g, p.s, [
      [9 - spread, 27],
      [13, 28],
      [12, 37],
      [8, 41],
      [6 - spread, 40],
    ]);
    polygon(g, p.t, [
      [14, 27],
      [17 + spread, 27],
      [19 + spread, 39],
      [17, 41],
      [13, 37],
    ]);
    rect(g, 13, 29, 1, 8, p.r);
    dot(g, 14, 31, p.F);
    dot(g, 14, 35, p.F);
  } else if (a.clothing === "apron") {
    polygon(g, p.B, [
      [10 - spread, 20],
      [17 + spread, 20],
      [17 + spread, 27],
      [19 + spread, 36],
      [17, 39],
      [8 - spread, 38],
      [7 - spread, 35],
      [10 - spread, 26],
    ]);
    polygon(g, p.F, [
      [11 - spread, 21],
      [16 + spread, 21],
      [16 + spread, 27],
      [18 + spread, 36],
      [16, 38],
      [8 - spread, 37],
      [9 - spread, 31],
      [11 - spread, 26],
    ]);
    polygon(g, p.D, [
      [15, 27],
      [17, 29],
      [18 + spread, 36],
      [16, 38],
      [15, 34],
    ]);
    rect(g, 11, 29, 5, 1, p.C);
    rect(g, 11, 30, 1, 3, p.D);
    rect(g, 12, 32, 4, 1, p.D);
  } else {
    polygon(g, p["1"], [
      [8 - spread, 27],
      [18 + spread, 26],
      [18 + spread, 28],
      [8 - spread, 29],
    ]);
    dot(g, 13, 27, p.E);
    dot(g, 14, 27, p.G);
  }
  // Converted portrait collars/lapels register to the same native body.
  const collar = atlas.clothes[a.clothing];
  for (let y = 14; y < 23; y++)
    for (let x = 8 - spread; x < 19 + spread; x++) {
      const sx = Math.round(25 + ((x - 13) * 2.15) / (1 + spread * 0.08));
      const sy = Math.round(35 + (y - 14) * 1.7);
      const char = collar[sy]?.[sx];
      if (p[char] && g.pixels[y * g.width + x]) dot(g, x, y, p[char]);
    }
  if (a.clothing === "apron")
    stamp(g, 9 - spread, 17, ["F.....F", ".F...F.", ".F...F.", "..FFF.."], p);
}
function walker(a: Appearance, p: Palette): Grid {
  const g = blank(walkerWidth, walkerHeight);
  const rows = atlas.bodies[a.build === "broad" ? "broad" : "medium"];
  layer(g, rows, p, a.build === "slight" ? 0.88 : 1, 13);
  outfit(g, a, p, rows);
  const head = blank(portraitWidth, portraitHeight);
  hair(head, a, p, false);
  face(head, a, p, true, false);
  const tilt = a.age === "elder" ? 1 : 0;
  // 3:1 head sampling maintains the approved adult, roughly five-head figure.
  for (let y = 0; y < 18; y++)
    for (let x = 0; x < 16; x++) {
      const value = head.pixels[(y * 3 + 1) * head.width + x * 3 + 1];
      if (value) dot(g, x + 5 + tilt, y, value);
    }
  const x = tilt;
  const near = a.mark === "glasses" ? 14 : 13;
  if (a.eyes === "open") {
    rect(g, near + x, 7, 1, 2, p["8"]);
    rect(g, 17 + x, 7, 1, 2, p["8"]);
    dot(g, near - 1 + x, 7, p["9"]);
    dot(g, 16 + x, 7, p["9"]);
  } else if (a.eyes === "straight") {
    rect(g, near - 1 + x, 7, 2, 1, p["8"]);
    rect(g, 16 + x, 7, 2, 1, p["8"]);
  } else {
    dot(g, near + x, 7, p["8"]);
    dot(g, 17 + x, 7, p["8"]);
  }
  if (a.age === "adult") dot(g, 14 + x, 10, p.d);
  if (a.age === "elder") {
    dot(g, 12 + x, 9, p.c);
    dot(g, 17 + x, 10, p.c);
  }
  if (a.mark === "freckles") {
    dot(g, 12 + x, 9, p.c);
    dot(g, 14 + x, 9, p.c);
    dot(g, 17 + x, 9, p.c);
  } else if (a.mark === "scar") {
    dot(g, 12 + x, 9, p.b);
    dot(g, 13 + x, 10, p.c);
  } else if (a.mark === "glasses")
    stamp(g, 12 + x, 6, [".ff.ff.", "f..f..f", ".ff.ff."], {
      f: rgba("#655546"),
    });
  // Hair is the last layer, so a new eye cannot paint over a fringe. It is
  // sampled without the old portrait eyes/brows that used to merge into bars.
  const fringe = blank(portraitWidth, portraitHeight);
  hair(fringe, a, p, true);
  for (let y = 0; y < 18; y++)
    for (let x = 0; x < 16; x++) {
      const value = fringe.pixels[(y * 3 + 1) * fringe.width + x * 3 + 1];
      if (value) dot(g, x + 5 + tilt, y, value);
    }
  return g;
}
export function characterRaster(
  a: Appearance,
  kind: "portrait" | "walker",
): CharacterRaster {
  const key = kind + ":" + appearanceKeys.map((k) => a[k]).join("|");
  const cached = cache.get(key);
  if (cached) {
    cache.delete(key);
    cache.set(key, cached);
    return cached;
  }
  const result =
    kind === "portrait" ? portrait(a, paletteFor(a)) : walker(a, paletteFor(a));
  cache.set(key, result);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  return result;
}
export function drawCharacter(
  ctx: CanvasRenderingContext2D,
  a: Appearance,
  kind: "portrait" | "walker",
) {
  const g = characterRaster(a, kind);
  // Opaque runs preserve the caller's background and shadow. No asynchronous
  // decode, external image requests or canvas state changes are required.
  for (let y = 0; y < g.height; y++)
    for (let x = 0; x < g.width;) {
      const color = g.pixels[y * g.width + x];
      let end = x + 1;
      while (end < g.width && g.pixels[y * g.width + end] === color) end++;
      if (color) {
        ctx.fillStyle = "#" + (color & 0xffffff).toString(16).padStart(6, "0");
        ctx.fillRect(x, y, end - x, 1);
      }
      x = end;
    }
}
