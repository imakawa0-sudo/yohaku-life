import type { LocationId, Resources } from "./types";

export type WorldOrigin = "household" | "solo" | "trader";

type Opening = {
  name: string;
  location: LocationId;
  description: string;
  pack: Resources;
  opening: string;
};
export const OPENINGS: Record<WorldOrigin, Opening> = {
  household: {
    name: "三人の共同生活", location: "home",
    description: "丘のふもとの家で、アキ・ミオ・レンが一緒に朝を迎えます。料理や調達を任せて、自分の手仕事を続けられます。",
    pack: { food: 0, ingredients: 0, medicine: 0, scrap: 0 },
    opening: "窓を開けると、草の匂いがした。食卓には三つの器。今日は、どんな一日にしよう。",
  },
  solo: {
    name: "川辺の一人旅", location: "meadow",
    description: "アキ一人で川沿いの採集地から。食事3食と手当用品1個を持ち、川辺で採るか、集落で道を聞くか選べます。",
    pack: { food: 3, ingredients: 0, medicine: 1, scrap: 0 },
    opening: "アキは川べりで荷を下ろした。包みには食事が三つと手当用品が一つ。草の間を探す時間も、川沿いの集落を訪ねる時間もある。",
  },
  trader: {
    name: "集落の行商", location: "village",
    description: "アキ一人で開店時の集落から。食事2食、手当用品1個、資材4個を持ち、物々交換と銀貨での商いを選べます。",
    pack: { food: 2, ingredients: 0, medicine: 1, scrap: 4 },
    opening: "軒下に品物台が出た。アキの荷には資材が四つ。いくつか売って銀貨を持ち歩いても、今日の食事とじかに取り替えてもいい。",
  },
};
