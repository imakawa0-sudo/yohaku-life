import type { Appearance, Persona } from "./peopleModel";

// The portrait and the walking sprite share five-step, hue-shifted colour ramps.
type Ramp = readonly [string, string, string, string, string];
const skins: Record<Appearance["skin"], Ramp> = {
  ivory: ["#644449", "#b67b72", "#dfaa8e", "#f4d2ad", "#ffebc4"],
  peach: ["#69424a", "#a86465", "#df9981", "#f9bd9a", "#ffdab4"],
  wheat: ["#5c3e44", "#9b6256", "#cb8a67", "#e6b481", "#f7ce97"],
  bronze: ["#4c3841", "#855052", "#ad6955", "#ce906d", "#ecb585"],
  umber: ["#39303e", "#60434a", "#86584e", "#aa7760", "#cc9673"],
};
const hairs: Record<Appearance["hairColor"], Ramp> = {
  ink: ["#292a35", "#363542", "#4b4750", "#65606a", "#878286"],
  chestnut: ["#352e36", "#51383d", "#795044", "#a97452", "#c99569"],
  ash: ["#35333b", "#50484a", "#756857", "#98896c", "#b8ad90"],
  honey: ["#534044", "#856448", "#b89559", "#d6b976", "#efda99"],
  silver: ["#4a4755", "#696773", "#96949a", "#c5c0b5", "#e9e3c9"],
};
const dyes: Record<Appearance["dye"], Ramp> = {
  moss: ["#313b3a", "#495747", "#677951", "#91a36e", "#b7bc86"],
  indigo: ["#303547", "#414f68", "#5c7390", "#87a0ad", "#b1c4c0"],
  brick: ["#45333e", "#71444b", "#9d5b53", "#c48668", "#dfab81"],
  rust: ["#44383a", "#775341", "#a7784a", "#cfa268", "#e9c68b"],
  plum: ["#3d3245", "#604561", "#875e7b", "#ae8193", "#cfabb0"],
  flax: ["#48423f", "#766c59", "#a29574", "#cabf98", "#e5d9b2"],
};
type Path = readonly number[];

// Filled spans on the native pixel grid, so a diagonally cut cheek or fringe has
// the same edge as a painted single pixel, at every display magnification.
function patch(ctx: CanvasRenderingContext2D, color: string, path: Path) {
  const ys = path.filter((_, i) => i % 2 === 1);
  ctx.fillStyle = color;
  for (let y = Math.min(...ys); y < Math.max(...ys); y++) {
    const intersections: number[] = [];
    for (let i = 0; i < path.length; i += 2) {
      const j = (i + 2) % path.length;
      const x1 = path[i],
        y1 = path[i + 1],
        x2 = path[j],
        y2 = path[j + 1];
      if (y1 > y + 0.5 === y2 > y + 0.5) continue;
      intersections.push(x1 + ((y + 0.5 - y1) / (y2 - y1)) * (x2 - x1));
    }
    intersections.sort((a, b) => a - b);
    for (let i = 0; i + 1 < intersections.length; i += 2) {
      const left = Math.ceil(intersections[i] - 0.5);
      const right = Math.ceil(intersections[i + 1] - 0.5);
      ctx.fillRect(left, y, right - left, 1);
    }
  }
}

function pixels(ctx: CanvasRenderingContext2D, color: string, points: Path) {
  ctx.fillStyle = color;
  for (let i = 0; i < points.length; i += 2)
    ctx.fillRect(points[i], points[i + 1], 1, 1);
}

function stamp(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rows: string[],
  palette: Record<string, string>,
) {
  for (const [row, line] of rows.entries()) {
    for (let col = 0; col < line.length; col++) {
      const color = palette[line[col]];
      if (color) {
        ctx.fillStyle = color;
        ctx.fillRect(x + col, y + row, 1, 1);
      }
    }
  }
}

function clothing(
  ctx: CanvasRenderingContext2D,
  a: Appearance,
  d: Ramp,
  s: Ramp,
) {
  const width = { slight: 3, medium: 1, broad: -1 }[a.build];
  const left = 4 + width,
    right = 43 - width;
  const p = (color: string, ...points: number[]) => patch(ctx, color, points);
  // A turned shoulder sits higher behind the neck. The shadows of the front
  // sleeve and the left-facing lapel describe the chest even on a tiny badge.
  p(
    d[0],
    left - 2,
    56,
    left - 2,
    51,
    left,
    46,
    left + 2,
    43,
    15,
    39,
    18,
    37,
    20,
    33,
    31,
    33,
    31,
    38,
    35,
    40,
    right - 4,
    42,
    right - 1,
    46,
    right + 1,
    50,
    right + 2,
    56,
  );
  p(
    d[2],
    left,
    56,
    left,
    50,
    left + 2,
    46,
    left + 5,
    43,
    18,
    39,
    29,
    37,
    35,
    41,
    right - 4,
    43,
    right,
    49,
    right + 1,
    56,
  );
  p(
    d[1],
    left,
    56,
    left,
    50,
    left + 3,
    45,
    left + 8,
    43,
    left + 6,
    47,
    left + 4,
    50,
    left + 6,
    49,
    left + 6,
    56,
  );
  p(
    d[3],
    left + 2,
    48,
    left + 3,
    45,
    left + 7,
    43,
    16,
    40,
    19,
    40,
    17,
    43,
    left + 8,
    44,
    left + 4,
    48,
  );
  p(
    d[1],
    right - 8,
    56,
    right - 7,
    51,
    right - 5,
    48,
    right - 4,
    43,
    right - 1,
    46,
    right,
    51,
    right + 1,
    56,
  );
  p(
    d[3],
    right - 9,
    52,
    right - 7,
    47,
    right - 6,
    44,
    right - 5,
    45,
    right - 6,
    49,
  );
  p(s[0], 18, 33, 30, 30, 31, 35, 30, 38, 33, 40, 27, 46, 23, 47, 17, 40);
  p(s[1], 19, 33, 29, 32, 29, 39, 31, 40, 26, 44, 24, 45, 18, 40);
  p(s[2], 21, 38, 29, 36, 29, 39, 30, 40, 25, 44, 21, 41);
  p(s[3], 24, 40, 29, 38, 29, 40, 25, 43);
  const linen = ["#51484c", "#8e806f", "#c4b792", "#e4d8ae"];
  if (a.clothing === "shirt" || a.clothing === "apron") {
    p(
      d[0],
      16,
      39,
      19,
      37,
      20,
      40,
      25,
      44,
      30,
      39,
      31,
      37,
      34,
      40,
      30,
      46,
      26,
      46,
      27,
      56,
      24,
      56,
      24,
      47,
      20,
      49,
      16,
      44,
    );
    p(d[3], 16, 40, 19, 38, 20, 41, 25, 44, 21, 47);
    p(d[4], 17, 40, 19, 39, 20, 41, 23, 44, 21, 44);
    p(d[2], 26, 44, 30, 39, 31, 38, 33, 40, 30, 45);
    p(d[3], 26, 46, 27, 46, 28, 56, 26, 56);
    pixels(ctx, linen[3], [25, 48, 26, 52]);
  }
  if (a.clothing === "apron") {
    // Keep the original body and shirt. Only place the apron straps inside the
    // existing shoulders, and join them to one clear bib edge below the collar.
    const nearStrap = { slight: 14, medium: 13, broad: 12 }[a.build];
    const farStrap = { slight: 33, medium: 34, broad: 35 }[a.build];
    p(linen[0], nearStrap-1,42, nearStrap+1,41, 19,48, 17,50);
    p(linen[2], nearStrap,42, nearStrap+1,42, 18,48, 17,48);
    p(linen[3], nearStrap,42, nearStrap+1,43, 18,48, 17,48);
    p(linen[0], farStrap,41, farStrap+2,42, 32,50, 30,48);
    p(linen[2], farStrap,42, farStrap+1,42, 31,48, 30,48);
    p(linen[0], 18,48, 31,48, 33,51, 33,56, 15,56, 16,51);
    p(linen[2], 19,49, 30,49, 32,51, 32,56, 16,56, 17,51);
    p(linen[3], 19,49, 30,49, 31,50, 19,50, 17,55, 16,55, 17,51);
    p(linen[1], 30,51, 32,51, 32,56, 30,56);
    pixels(ctx, linen[1], [20,53, 21,53, 22,53, 23,53, 24,53, 25,53, 26,53, 27,53, 20,54]);
    pixels(ctx, "#deab62", [18,49, 31,49]);
  } else if (a.clothing === "wrap") {
    p(
      d[0],
      15,
      39,
      18,
      37,
      25,
      43,
      31,
      37,
      35,
      40,
      27,
      49,
      21,
      56,
      15,
      56,
      20,
      49,
      22,
      46,
    );
    p(linen[2], 16, 39, 18, 38, 25, 44, 23, 46);
    p(linen[1], 16, 41, 23, 46, 22, 47);
    p(d[2], 31,39, 34,40, 26,49, 20,56, 17,56, 24,46);
    p(linen[2], 31,39, 33,40, 25,49, 19,56, 17,56, 24,47);
    p(linen[3], 31,39, 32,40, 26,46, 25,46);
    p(d[1], 25, 52, 31, 47, 35, 46, 29, 51);
  } else if (a.clothing === "coat") {
    p(
      d[0],
      13,
      41,
      17,
      37,
      20,
      37,
      21,
      40,
      25,
      44,
      30,
      37,
      33,
      37,
      36,
      41,
      32,
      46,
      34,
      47,
      27,
      55,
      27,
      56,
      21,
      56,
      21,
      49,
      14,
      46,
      16,
      44,
    );
    p(d[1], 14,42, 17,39, 19,38, 23,45, 21,48, 16,44);
    p(d[3], 16,41, 18,39, 19,39, 21,43, 19,42, 17,42);
    p(d[2], 25, 45, 30, 38, 32, 38, 34, 41, 30, 45, 31, 47, 25, 53);
    p(d[3], 26, 45, 31, 39, 33, 40, 29, 43);
    p(linen[2], 20, 40, 23, 41, 26, 42, 29, 40, 27, 44, 25, 45, 23, 44);
    pixels(ctx, "#dbb875", [23, 49, 23, 53]);
  }
}

function backHair(ctx: CanvasRenderingContext2D, a: Appearance, h: Ramp) {
  const p = (color: string, ...points: number[]) => patch(ctx, color, points);
  if (a.hair === "wave" || a.hair === "bob") {
    const long = a.hair === "wave";
    p(
      h[0],
      9,
      15,
      33,
      12,
      37,
      17,
      36,
      25,
      37,
      31,
      36,
      35,
      38,
      long ? 43 : 35,
      32,
      long ? 41 : 36,
      26,
      34,
      18,
      36,
      12,
      long ? 44 : 37,
      5,
      long ? 46 : 36,
      7,
      33,
      5,
      34,
      7,
      26,
    );
    p(
      h[1],
      10,
      16,
      34,
      14,
      35,
      21,
      34,
      26,
      36,
      32,
      35,
      35,
      36,
      long ? 39 : 35,
      30,
      34,
      18,
      34,
      13,
      long ? 41 : 35,
      7,
      long ? 44 : 35,
      9,
      32,
      7,
      32,
      9,
      25,
    );
    p(
      h[2],
      10,
      24,
      12,
      20,
      11,
      28,
      11,
      32,
      9,
      36,
      9,
      long ? 40 : 35,
      7,
      long ? 41 : 35,
      9,
      34,
    );
    if (long) p(h[2], 33, 24, 34, 27, 34, 32, 36, 37, 34, 36, 32, 32);
  } else if (a.hair === "knot") {
    p(
      h[0],
      12,
      8,
      12,
      5,
      9,
      3,
      5,
      4,
      3,
      7,
      3,
      11,
      5,
      14,
      8,
      15,
      11,
      14,
      14,
      11,
    );
    p(h[2], 11, 8, 11, 6, 9, 4, 6, 5, 4, 7, 4, 10, 6, 13, 9, 13, 11, 11);
    p(h[3], 5, 7, 7, 5, 9, 5, 8, 6, 6, 7, 5, 9);
    p(h[1], 9, 6, 10, 9, 7, 12, 5, 12, 8, 9);
  }
}

const fringe: Record<Appearance["hair"], Path> = {
  crop: [
    10, 24, 8, 21, 8, 16, 9, 12, 11, 8, 15, 5, 19, 4, 24, 5, 27, 4,
    32, 6, 35, 9, 37, 14, 36, 17, 33, 16, 31, 15, 31, 17,
    27, 15, 25, 17, 22, 16, 19, 18, 17, 18, 15, 22, 13, 21, 12, 25,
  ],
  bob: [
    8, 28, 7, 23, 7, 15, 8, 11, 11, 7, 15, 5, 21, 4, 27, 4, 32, 6, 35, 9, 37,
    14, 37, 19, 34, 18, 32, 17, 32, 19, 28, 17, 27, 19, 23, 18, 20, 18, 19, 21,
    18, 18, 17, 22, 17, 28, 15, 32, 16, 34, 12, 34, 9, 36, 10, 31, 8, 32,
  ],
  wave: [
    8, 27, 7, 23, 6, 18, 8, 12, 10, 9, 14, 6, 19, 4, 23, 5, 27, 4, 32, 6, 35,
    10, 36, 14, 38, 17, 34, 17, 31, 15, 29, 12, 28, 16, 24, 18, 20, 18, 17, 22,
    16, 26, 13, 27, 14, 23, 11, 26,
  ],
  knot: [
    9, 24, 7, 19, 7, 15, 9, 10, 13, 6, 19, 4, 25, 5, 27, 4, 32, 6, 35, 9, 36,
    15, 37, 17, 33, 16, 31, 13, 27, 12, 23, 13, 21, 16, 18, 18, 15, 21, 14, 25,
    12, 26,
  ],
  braid: [
    8, 24, 7, 20, 7, 15, 8, 11, 11, 8, 16, 5, 21, 4, 26, 4, 30, 5, 34, 8, 36,
    12, 37, 17, 34, 16, 33, 18, 30, 14, 27, 12, 24, 16, 19, 18, 17, 21, 15, 26,
    12, 28, 12, 24, 10, 27,
  ],
};

function hairFront(ctx: CanvasRenderingContext2D, a: Appearance, h: Ramp) {
  const p = (color: string, ...points: number[]) => patch(ctx, color, points);
  patch(ctx, h[0], fringe[a.hair]);
  // Common crown light follows the head; each style finishes in different locks.
  p(
    h[1],
    8,
    19,
    9,
    13,
    12,
    9,
    16,
    6,
    21,
    5,
    26,
    6,
    28,
    5,
    32,
    7,
    34,
    10,
    35,
    14,
    32,
    13,
    30,
    11,
    26,
    11,
    23,
    14,
    19,
    17,
    16,
    18,
    14,
    22,
    11,
    23,
  );
  p(
    h[2],
    9,
    17,
    10,
    13,
    13,
    9,
    17,
    7,
    21,
    6,
    26,
    7,
    28,
    6,
    32,
    8,
    34,
    11,
    31,
    10,
    28,
    9,
    25,
    10,
    22,
    13,
    18,
    15,
    16,
    16,
    14,
    18,
    11,
    20,
    13,
    16,
  );
  p(h[3], 11, 14, 12, 11, 16, 8, 20, 7, 24, 7, 23, 8, 20, 8, 17, 10, 14, 11);
  p(h[3], 11, 16, 14, 13, 18, 11, 21, 10, 18, 13, 14, 15);
  p(h[3], 25, 8, 28, 7, 31, 8, 33, 10, 30, 9, 28, 9);
  pixels(ctx, h[4], [15, 9, 16, 9, 18, 8, 19, 8]);
  if (a.hair === "bob") {
    p(
      h[2],
      10,
      20,
      13,
      17,
      16,
      16,
      18,
      15,
      16,
      20,
      16,
      25,
      15,
      29,
      13,
      30,
      14,
      25,
      12,
      28,
      10,
      32,
      11,
      26,
    );
    p(
      h[2],
      18,
      15,
      23,
      12,
      26,
      10,
      28,
      10,
      30,
      12,
      33,
      13,
      35,
      17,
      31,
      15,
      30,
      16,
      27,
      14,
      27,
      16,
      24,
      15,
      21,
      17,
      18,
      17,
    );
    p(h[3], 11, 21, 13, 18, 15, 17, 13, 21, 12, 25, 11, 26);
  } else if (a.hair === "crop") {
    p(
      h[2],
      16,
      15,
      20,
      14,
      25,
      10,
      28,
      10,
      31,
      11,
      34,
      14,
      31,
      13,
      33,
      15,
      28,
      13,
      28,
      16,
      25,
      14,
      22,
      16,
      22,
      15,
      19,
      16,
      17,
      18,
    );
    p(h[3], 15, 7, 15, 6, 17, 5, 20, 5, 18, 6);
  } else if (a.hair === "knot") {
    p(
      h[2],
      8,
      17,
      11,
      15,
      10,
      18,
      12,
      17,
      16,
      14,
      20,
      12,
      17,
      16,
      13,
      19,
      12,
      22,
      10,
      21,
    );
  } else if (a.hair === "wave") {
    p(
      h[2],
      9,
      22,
      13,
      17,
      17,
      15,
      21,
      14,
      24,
      11,
      25,
      10,
      27,
      10,
      24,
      15,
      21,
      17,
      17,
      18,
      14,
      23,
      12,
      24,
      13,
      21,
      10,
      24,
    );
    p(h[3], 15, 16, 20, 13, 21, 13, 17, 16);
    p(h[1], 28, 10, 30, 10, 32, 12, 34, 14, 35, 15, 32, 14);
  }
  if (a.hair === "braid") {
    p(
      h[0],
      12,
      25,
      15,
      26,
      15,
      30,
      13,
      32,
      15,
      34,
      14,
      37,
      13,
      39,
      14,
      41,
      12,
      45,
      9,
      46,
      8,
      43,
      9,
      39,
      8,
      37,
      9,
      33,
      8,
      31,
      9,
      28,
    );
    p(h[2], 12, 26, 14, 27, 13, 29, 11, 31, 10, 31, 10, 29);
    p(h[1], 10, 31, 12, 30, 14, 32, 13, 34, 11, 35, 9, 34);
    p(h[3], 10, 32, 12, 31, 13, 32, 11, 33);
    p(h[2], 12, 34, 14, 35, 12, 38, 10, 39, 9, 37);
    p(h[3], 11, 35, 13, 35, 11, 37, 10, 37);
    p(h[2], 10, 39, 12, 39, 13, 41, 12, 43, 9, 44, 10, 42);
    p(h[3], 10, 44, 13, 43, 12, 45, 9, 45);
    p(h[0], 10, 45, 12, 45, 13, 48, 11, 51, 8, 52, 9, 48);
    p(h[2], 10, 46, 12, 46, 12, 48, 9, 50);
    pixels(ctx, "#cea159", [9, 44, 10, 44, 11, 44]);
  }
}

function portraitFace(
  ctx: CanvasRenderingContext2D,
  a: Appearance,
  s: Ramp,
  h: Ramp,
) {
  const p = (color: string, ...points: number[]) => patch(ctx, color, points);
  const chin = { oval: 37, round: 35, angular: 36 }[a.face];
  const jawLeft = { oval: 19, round: 18, angular: 17 }[a.face];
  const jawRight = a.face === "oval" ? 33 : 34;

  // One quiet three-quarter face: the cheek stays behind the nose instead of
  // forming a second nose-shaped bump in the silhouette.
  p(s[0], 14,16, 16,12, 20,9, 27,8, 32,10, 34,14, 35,19,
    35,26, jawRight,31, 30,chin-1, 28,chin, 24,chin,
    jawLeft,chin-4, 16,30, 14,26);
  p(s[2], 15,16, 17,12, 21,10, 27,9, 31,11, 33,14, 34,19,
    34,26, jawRight-1,30, 29,chin-2, 27,chin-1, 24,chin-1,
    jawLeft+1,chin-4, 17,29, 15,25);
  // Broad connected planes leave room for eyes and lips to read as features.
  p(s[1], 15,16, 18,13, 18,20, 17,24, 18,29,
    22,chin-2, jawLeft,chin-4, 16,30, 14,26);
  p(s[3], 21,13, 27,11, 31,12, 33,16, 33,21, 32,24,
    33,27, 30,29, 25,29, 20,27, 19,23, 20,18);
  p(s[3], 23,31, 29,31, 30,32, 27,chin-2, 25,chin-2);
  // The ear is a single connected shape, level with the eyes and nose.
  stamp(ctx, 11, 21, [
    ".sss.", "smmms", "smlls", "smsms", ".smms", "..ss.",
  ], { s: s[1], m: s[2], l: s[3] });

  const eyeInk = "#403942";
  const eyeWhite = "#f7e8ce";
  const iris = "#7c6654";
  const eyeY = 21;
  const eyePalette = { d: eyeInk, w: eyeWhite, i: iris };
  // Both eyes share a baseline and gaze. The far eye is narrower, rather than
  // being lifted into the eyebrow. All pixels belong to a connected cluster.
  if (a.eyes === "open") {
    stamp(ctx, 20, eyeY, [".ddd.", "wwidd", ".ddd."], eyePalette);
    stamp(ctx, 29, eyeY, [".dd.", "widd", ".dd."], eyePalette);
  } else if (a.eyes === "straight") {
    stamp(ctx, 20, eyeY, ["ddddd", "..id."], eyePalette);
    stamp(ctx, 29, eyeY, ["dddd", ".id."], eyePalette);
  } else {
    stamp(ctx, 20, eyeY, ["dddd.", "wwid."], eyePalette);
    stamp(ctx, 29, eyeY, ["ddd.", "wid."], eyePalette);
  }
  const browY = a.mark === "glasses" ? 17 : 18;
  pixels(ctx, h[1], [20,browY, 21,browY, 22,browY, 23,browY,
    29,browY, 30,browY, 31,browY]);
  if (a.eyes === "straight") {
    pixels(ctx, h[1], [24,browY+1, 28,browY+1]);
  }

  // Nose, mouth and chin share x≈27. No white teeth/lip stripe and no dark
  // cheek-to-mouth hook: these had made every face look like a strained grin.
  pixels(ctx, s[1], [28,24, 28,25, 29,26]);
  pixels(ctx, s[2], [27,26, 28,27]);
  pixels(ctx, s[4], [27,24]);
  pixels(ctx, s[1], [25,30, 26,30, 27,30, 28,30]);
  pixels(ctx, s[2], [26,31, 27,31]);

  if (a.age === "adult") {
    pixels(ctx, s[2], [20,24, 21,24, 31,24]);
  } else if (a.age === "elder") {
    pixels(ctx, s[1], [18,23, 19,24, 32,24, 32,28, 31,29, 22,30]);
    pixels(ctx, s[2], [20,25, 21,25, 23,32, 24,33, 29,33]);
  }
  if (a.mark === "freckles") {
    pixels(ctx, s[1], [19,26, 21,26, 23,27, 31,26, 33,25]);
  } else if (a.mark === "scar") {
    pixels(ctx, s[1], [18,25, 19,26, 20,27]);
    pixels(ctx, s[3], [18,26, 19,27]);
  } else if (a.mark === "glasses") {
    // Lens centres register to the eyes (22,22) and (31,22); the bridge lives
    // between them. The frames never move the eyes or cover their pupils.
    const frame = { f: "#6d5c50" };
    stamp(ctx, 18, 19, [
      "..ffff..", ".f....f.", "f......f", "f......f",
      "f......f", ".f....f.", "..ffff..",
    ], frame);
    stamp(ctx, 28, 19, [
      ".ffff.", "f....f", "f....f", "f....f", "f....f", ".ffff.",
    ], frame);
    pixels(ctx, frame.f, [14,21, 15,21, 16,20, 17,20, 26,21, 27,21]);
    pixels(ctx, "#c7ad85", [20,19, 21,19, 30,19]);
  }
}

export function drawPortrait(ctx: CanvasRenderingContext2D, person: Persona) {
  const a = person.appearance,
    h = hairs[a.hairColor],
    s = skins[a.skin],
    d = dyes[a.dye];
  backHair(ctx, a, h);
  clothing(ctx, a, d, s);
  portraitFace(ctx, a, s, h);
  hairFront(ctx, a, h);
  if (a.age === "elder") {
    pixels(ctx, "#b1a6a1", [11, 20, 11, 21, 12, 19, 13, 18, 34, 14]);
  }
}

// Native art grid shared by the maker and the scenery compositing layer.
export const walkerWidth = 26;
export const walkerHeight = 60;

const piping: Record<Appearance["dye"], [string, string]> = {
  moss: ["#b57952", "#e5b575"],
  indigo: ["#b67965", "#e8ac83"],
  brick: ["#73918b", "#add1bd"],
  rust: ["#728681", "#b1c3a4"],
  plum: ["#b28c61", "#e6bf88"],
  flax: ["#748e8a", "#a2c1b0"],
};
const twill: Ramp = ["#343746", "#45465a", "#5e6777", "#829294", "#a4afab"];
const leather: Ramp = ["#473844", "#654951", "#895d53", "#b17c60", "#dbac7e"];
const linen: Ramp = ["#655b61", "#918276", "#bead93", "#ddcdb0", "#f2e5cb"];

function standingLegs(ctx: CanvasRenderingContext2D, outfit: Appearance["clothing"]) {
  const fill = (color: string, ...points: number[]) => patch(ctx, color, points);
  const t = twill, b = leather;
  // Everyday shoes rest nearly level; the travel outfits have a slightly turned-in back ankle.
  if (outfit === "shirt" || outfit === "apron") {
    fill(t[0], 12,30, 18,30, 18,37, 17,41, 18,45, 18,48, 20,54, 16,56, 14,50, 13,46, 13,44, 11,41);
    fill(t[1], 13,31, 17,31, 17,37, 16,42, 17,45, 17,48, 19,54, 17,54, 15,48, 14,44, 13,41);
    fill(t[2], 16,33, 17,33, 16,39, 16,42, 14,40);
    fill(t[2], 15,44, 17,43, 17,44, 16,46);
    fill(t[2], 16,49, 18,50, 19,53, 17,53);
    fill(linen[2], 15,52, 19,51, 20,53, 16,54);
    fill(b[0], 16,54, 20,53, 20,55, 23,56, 24,58, 23,59, 16,59);
    fill(b[2], 17,54, 19,54, 20,56, 22,56, 23,57, 21,58, 17,58);
    pixels(ctx, b[3], [18,54, 19,55, 21,56, 22,56]);
  } else {
    fill(t[0], 11,29, 18,29, 18,33, 17,37, 19,40, 20,42, 19,45, 18,49, 17,54, 13,54, 13,50, 15,44, 15,42, 11,38);
    fill(t[1], 13,30, 17,30, 16,36, 18,40, 19,42, 18,45, 17,49, 16,53, 14,53, 15,46, 17,43, 16,41, 13,38);
    fill(t[2], 16,36, 18,40, 19,42, 16,44, 17,42);
    fill(t[2], 15,47, 18,46, 16,50, 15,51);
    fill(linen[1], 14,50, 18,51, 17,53, 13,52);
    fill(b[0], 14,52, 18,53, 18,55, 21,56, 22,57, 21,58, 16,58, 13,56);
    fill(b[2], 14,53, 17,53, 17,55, 20,56, 20,57, 15,56, 14,55);
    pixels(ctx, b[3], [15,53, 16,54, 19,56]);
  }

  fill(t[0], 8,29, 16,30, 17,34, 16,38, 13,43, 12,46, 13,48, 12,54, 7,55, 7,51, 8,47, 7,43, 6,39, 6,34);
  fill(t[2], 9,30, 15,31, 16,34, 15,37, 12,42, 11,46, 12,47, 11,52, 8,53, 8,50, 9,47, 8,44, 7,39, 7,34);
  fill(t[3], 8,33, 12,32, 11,35, 9,38, 8,42, 7,39);
  fill(t[1], 13,33, 16,34, 15,37, 12,41, 10,42, 12,38);
  fill(t[1], 8,42, 12,41, 12,43, 9,45);
  fill(t[3], 9,43, 12,42, 11,44, 9,45);
  fill(t[3], 9,47, 11,46, 10,50, 8,52);
  const highBoot = outfit === "coat" || outfit === "wrap";
  if (highBoot) {
    fill(b[0], 7,49, 13,48, 12,52, 11,55, 7,56);
    fill(b[2], 8,50, 12,50, 10,55, 7,55);
    fill(b[3], 8,50, 11,49, 10,51, 8,52);
  } else {
    fill(linen[1], 7,51, 13,51, 12,54, 7,55);
    fill(linen[3], 7,51, 12,51, 11,52, 7,53);
    fill(linen[2], 8,53, 11,53, 10,56, 8,55);
  }
  fill(b[0], 7,54, 11,54, 12,56, 15,57, 16,58, 15,60, 6,60, 5,58);
  fill(b[2], 7,55, 10,55, 12,57, 14,57, 15,58, 10,59, 6,58);
  fill(b[1], 7,56, 10,55, 12,57, 9,57, 7,58);
  pixels(ctx, b[3], [11,57, 12,57, 13,57, 6,57]);
  pixels(ctx, highBoot ? b[4] : linen[3], [8,55, 9,55]);
}

function standingOutfit(ctx: CanvasRenderingContext2D, a: Appearance, cloth: Ramp, skin: Ramp) {
  const fill = (color: string, ...points: number[]) => patch(ctx, color, points);
  const spread = { slight: -1, medium: 0, broad: 1 }[a.build];
  const l = 7 - spread, r = 18 + spread, c = cloth, s = skin;
  const [trim, lightTrim] = piping[a.dye];
  const shortSleeve = a.clothing === "shirt" || a.clothing === "apron";

  // The far elbow angles away from the waist, leaving air between arm and jacket.
  fill(c[0], 15,16, r,15, r+2,16, r+4,20, r+5,22, r+5,24, r+2,27, r,28, r-1,25, r+2,23, r,21, r-2,21);
  fill(c[2], r-1,16, r+1,17, r+4,22, r+4,24, r+2,25, r+1,23, r+1,21, r-1,20);
  fill(c[3], r,16, r+1,17, r+3,21, r+1,20);
  const forearm = shortSleeve ? s[2] : c[2];
  fill(forearm, r+3,23, r+4,24, r+1,27, r-1,28, r-1,26);
  fill(shortSleeve ? linen[2] : c[3], r+1,22, r+3,21, r+4,23, r+2,24);

  // The waist leans left while the near hip and the far shoulder turn back toward the viewer.
  fill(c[0], 11,15, 15,15, r-1,14, r,15, r+1,18, r,21, r-2,24, r-3,26, r-2,28, r-1,32, r-4,34, 10,33, l-2,32, l-1,28, l+1,24, l-1,21, l-1,18);
  fill(c[2], 11,16, 15,16, r-1,15, r,17, r-1,21, r-3,25, r-3,27, r-1,31, 14,32, l-1,31, l+1,27, l+2,24, l,21, l,18);
  fill(c[3], l,18, 11,16, 13,17, 13,20, 11,20, l+2,22);
  fill(c[3], 14,18, r-1,16, r-1,19, 16,21, 13,22);
  fill(c[1], 10,21, 12,22, 15,21, 14,23, 10,25, 9,27);
  fill(c[1], 12,27, r-3,25, r-2,29, 14,31, 10,31);

  if (a.clothing === "coat") {
    // Flared travel coat with pale lining visible on the turning tails.
    fill(c[0], l+1,24, r-3,24, r-1,29, r,33, r+2,36, r+4,38, r+2,40, 17,40, 14,37, 12,41, l-4,43, l-5,41, l-2,35, l-1,29);
    fill(c[1], 14,25, r-3,25, r-1,30, r+1,35, r+3,38, r,39, 16,37, 14,34);
    fill(trim, r,35, r+3,38, r+1,39, r-2,37);
    fill(c[2], l+1,25, 15,25, 13,30, 12,35, 10,39, l-4,42, l-2,37, l,30);
    fill(c[3], l+1,27, 11,26, 10,30, l-2,39, l-1,34);
    fill(lightTrim, l-3,40, 10,38, 11,38, 10,40, l-4,42);
    fill(c[0], 10,16, 12,15, 15,16, 13,19, 14,20, 11,23, 11,20, 9,19);
    fill(c[3], 10,16, 12,15, 14,16, 12,19, 13,20, 11,22, 11,19);
    fill(trim, 16,15, 18,15, 17,18, 13,22);
    fill(leather[0], l,26, r-2,24, r-2,26, l,28);
    pixels(ctx, lightTrim, [12,25, 13,25, 12,26, 12,31, 10,34]);
  } else if (a.clothing === "wrap") {
    // Crossed silk, a broad double sash, and a turned-out triangular hem.
    fill(c[0], l,26, r-2,25, r-1,29, r+1,33, r+2,35, r-1,37, 13,34, l-2,37, l-3,35);
    fill(c[2], l+1,26, r-3,26, r-1,30, r+1,35, r-1,36, 12,33, l-2,36);
    fill(c[3], l+1,28, 12,27, 12,29, l-2,35);
    fill(c[1], r-3,27, r-2,28, r,34, 13,32);
    fill(linen[1], 10,15, 12,15, 15,18, 14,21, 11,18);
    fill(linen[4], 10,15, 12,15, 14,18, 13,19);
    fill(trim, r-1,15, r,16, 16,20, 10,26, 8,26, 13,19);
    fill(lightTrim, r-1,15, r,16, 14,21, 13,21);
    fill(leather[0], l+1,25, r-2,23, r-2,28, l,30);
    fill(trim, l+1,25, r-2,24, r-2,27, l+1,28);
    fill(lightTrim, l,26, 11,25, 11,27, l-2,30, l-2,28);
    pixels(ctx, lightTrim, [14,25,15,25,16,25]);
  } else if (a.clothing === "apron") {
    // An apron fitted on the bias; a pleated side and copper studded pocket.
    fill(linen[0], l+1,16, l+3,16, 12,20, 11,22);
    fill(linen[3], l+1,16, l+2,16, 12,20, 11,20);
    fill(linen[2], r-2,15, r-1,15, 16,21, 15,21);
    fill(linen[0], 10,19, 16,19, 15,24, r-1,29, r+1,37, r-2,39, 10,40, l-3,38, l-2,33, l+1,26, 10,23);
    fill(linen[2], 11,20, 15,20, 14,24, r-2,29, r,36, r-2,38, 10,39, l-2,37, l-1,32, l+2,26);
    fill(linen[3], 11,20, 14,20, 13,23, 10,25);
    fill(linen[3], 9,26, 12,25, 10,31, l-1,37, l-2,36);
    fill(linen[1], 14,25, 16,28, 17,33, 16,37, 14,37, 15,32);
    fill(trim, 10,24, 16,23, 16,25, 9,26);
    fill(c[1], 12,28, 16,27, 16,30, 14,32, 12,31);
    fill(c[3], 12,28, 16,27, 16,28, 12,29);
    pixels(ctx, lightTrim, [11,20, 15,20, 13,29, 15,28]);
  } else {
    // A tucked shirt with an open pearl collar, a neckerchief and rolled sleeves.
    fill(c[0], l+1,27, r-2,26, r-1,29, 14,31, l-1,30);
    fill(c[3], l+1,27, 12,27, 15,26, 13,29, l,29);
    fill(leather[1], l-1,29, r-1,27, r-1,29, l-1,31);
    fill(linen[4], 10,16, 12,15, 14,17, 13,20, 10,18);
    fill(linen[2], 15,16, 17,14, 18,15, 16,19, 14,18);
    fill(trim, 13,17, 16,16, 16,18, 14,19, 14,21, 12,23, 12,20);
    pixels(ctx, lightTrim, [14,17, 13,20, 12,29, 13,29]);
    pixels(ctx, c[4], [14,22, 13,25]);
  }

  const handUp = a.clothing === "coat" || a.clothing === "apron";
  if (handUp) {
    // Thumb hooks the lapel / apron strap, and the forearm crosses the chest.
    fill(c[0], l,17, l+3,18, l+2,21, l+1,24, 10,22, 11,25, l,28, l-2,28, l-4,26, l-3,22);
    fill(c[2], l,18, l+2,18, l+2,20, l,23, l-1,25, 9,23, 10,24, l,27, l-2,27, l-3,25, l-2,22);
    fill(c[3], l,18, l+2,18, l+1,20, l-2,23);
    fill(shortSleeve ? linen[3] : c[3], 8,22, 10,21, 12,24, 9,25);
    fill(s[0], 10,21, 12,19, 14,19, 14,21, 12,23, 11,24, 9,23);
    fill(s[2], 10,21, 12,20, 13,20, 13,21, 11,23, 10,23);
    pixels(ctx, s[3], [11,21, 12,20]);
  } else {
    // Relaxed left elbow: the forearm swings inward so the fingers just graze the thigh.
    fill(c[0], l,17, l+3,18, l+2,21, l,24, l-2,27, l,31, l+1,32, l-1,34, l-3,32, l-5,27, l-4,24, l-3,20);
    fill(c[2], l,18, l+2,18, l+1,21, l-1,24, l-3,27, l-2,29, l-1,32, l-2,32, l-4,27, l-3,23);
    fill(c[3], l,18, l+2,18, l+1,20, l-2,22);
    fill(shortSleeve ? linen[3] : c[3], l-4,25, l-1,23, l,25, l-3,27);
    if (shortSleeve) fill(s[2], l-4,27, l-2,26, l,31, l-1,32, l-3,29);
    fill(s[0], l-1,31, l+1,30, l+1,32, l+3,34, l+2,36, l,35, l-1,33);
    fill(s[2], l,31, l+1,32, l+2,34, l+1,35, l,34);
    pixels(ctx, s[3], [l,32, l+1,33]);
  }
  // Knuckles of the far hand rest on the hip in front of the garment.
  fill(s[0], r,25, r+2,26, r+1,28, r-2,29, r-3,28, r-2,26);
  fill(s[2], r,26, r+1,26, r,28, r-2,28, r-2,27);
  pixels(ctx, s[3], [r,26, r-1,26]);
}

function standingHead(ctx: CanvasRenderingContext2D, a: Appearance, skin: Ramp, hair: Ramp) {
  const x = a.age === "elder" ? 8 : 7, y = a.age === "young" ? 2 : 3;
  const [trim, lightTrim] = piping[a.dye];
  const colors = {
    o: skin[0], s: skin[1], m: skin[2], l: skin[3], L: skin[4],
    h: hair[0], a: hair[1], b: hair[2], c: hair[3], d: hair[4], t: trim, T: lightTrim,
  };
  const jaw = { oval: "...smmmlls.", round: "..smmllLlls", angular: "..ssmmlmlls" }[a.face];
  stamp(ctx, x, y, [
    "....sssss..", "..ssmlllms.", ".smmlllllls", ".smlLLLLlls", ".smmllllLlm",
    "smmlllllllm", "smsmlllLlll", ".smmLlmlllL", "..smllmlllm", jaw, "....smmllo.",
  ], colors);
  // A warm cheek, a small smile and open light between the eyes read at a single native pixel.
  pixels(ctx, skin[1], [x+7,y+8, x+7,y+9, x+8,y+9]);
  pixels(ctx, skin[4], [x+7,y+7, x+8,y+10]);
  pixels(ctx, skin[2], [x+4,y+8, x+5,y+8, x+9,y+8]);
  const eye = "#3d3544", glint = "#faf1d6";
  pixels(ctx, hair[1], [x+3,y+4, x+4,y+4, x+5,y+4, x+8,y+4, x+9,y+4]);
  if (a.eyes === "soft") {
    pixels(ctx, eye, [x+3,y+6, x+4,y+5, x+5,y+5, x+8,y+6, x+9,y+5]);
    pixels(ctx, skin[4], [x+5,y+6]);
  } else {
    pixels(ctx, eye, [x+4,y+5, x+5,y+5, x+5,y+6, x+8,y+5, x+9,y+5, x+9,y+6]);
    pixels(ctx, glint, [x+4,y+6, x+8,y+6]);
    if (a.eyes === "open") {
      pixels(ctx, hair[1], [x+5,y+7, x+9,y+7]);
      pixels(ctx, glint, [x+4,y+5, x+8,y+5]);
    } else pixels(ctx, eye, [x+3,y+5, x+8,y+5]);
  }
  if (a.age === "adult") pixels(ctx, skin[2], [x+4,y+7, x+6,y+9]);
  if (a.age === "elder") pixels(ctx, skin[1], [x+3,y+7, x+4,y+7, x+8,y+8, x+9,y+9]);
  if (a.mark === "freckles") pixels(ctx, skin[1], [x+3,y+8, x+5,y+7, x+9,y+8]);
  if (a.mark === "scar") pixels(ctx, skin[4], [x+4,y+7, x+3,y+8, x+3,y+9]);
  if (a.mark === "glasses") {
    pixels(ctx, "#554654", [x+1,y+5, x+2,y+5, x+3,y+4, x+4,y+4, x+5,y+4, x+6,y+5, x+7,y+5, x+8,y+4, x+9,y+4, x+10,y+5, x+2,y+6]);
    pixels(ctx, "#b68f66", [x+3,y+7, x+4,y+7, x+5,y+7, x+6,y+6, x+8,y+7, x+9,y+7, x+10,y+6]);
  }

  // Each hairdo is a hand-cut silhouette: sweep, flyaways, ear and fringe occupy different pixels.
  if (a.hair === "wave") {
    stamp(ctx, x-4, y-1, [
      "......abbba....", "....abccdccba..", "...abcddccbbba.", "..abccbbccbaab.", "..bcbabccbb....",
      ".abbbcbaab.....", ".abbcaab.......", ".acbcah........", "..cbabh........", "..abcbah.......",
      ".abcbcah.......", ".bcbbba........", "abcbba.........", "bbaacb.........", ".a..bbha.......", ".....ah........",
    ], colors);
  } else if (a.hair === "braid") {
    stamp(ctx, x-3, y-1, [
      "......abbb....", "....abccdccba.", "...acdddccbbba", "..acbcbbcbbaa.", "..bbbcbbba....", "..babcbah.....",
      "..baba........", "...abch.......", "...bcba.......", "...abcb.......", "..abcb........", "..bcba........",
      ".abcba........", ".bcca.........", "..tT..........", ".bc...........", ".a............",
    ], colors);
  } else if (a.hair === "knot") {
    stamp(ctx, x-3, y-1, [
      "...ab...abb....", ".abccbabcccbba.", "abccbbcddcccbba", "bcbbtabccbbbaa.", "abcaTbbbbbaa...",
      ".aahbabbba.....", "....baah.......", "....ah.........",
    ], colors);
    pixels(ctx, lightTrim, [x-1,y+2, x,y+3]);
  } else if (a.hair === "bob") {
    stamp(ctx, x-3, y-1, [
      "......abbba....", "....abccddcba..", "...bccddcccbba.", "..acccbbcccbaa.", "..bcbcbbbbaab..",
      "..bcabbba......", "..cbbbah.......", "..cbbah........", ".bcbbba........", ".abcbbha.......", "..abbaa........", "....a..........",
    ], colors);
  } else {
    stamp(ctx, x-3, y-1, [
      "......ab.ba....", "....abccbcba...", "...bccdcccccba.", ".abccbbcccbbbaa", "..cbabbbcbbaa..",
      "..bcbbaba......", "..abcbah.......", "...abh.........", "...a...........",
    ], colors);
  }
}

export function drawWalker(ctx: CanvasRenderingContext2D, person: Persona): void {
  const a = person.appearance, skin = skins[a.skin];
  standingLegs(ctx, a.clothing);
  standingOutfit(ctx, a, dyes[a.dye], skin);
  const tilt = a.age === "elder" ? 1 : 0;
  patch(ctx, skin[1], [11+tilt,11, 16+tilt,11, 15,14, 16,16, 14,18, 11,17, 12,15]);
  patch(ctx, skin[2], [13+tilt,13, 15+tilt,12, 15,15, 14,17, 12,16]);
  standingHead(ctx, a, skin, hairs[a.hairColor]);
}
