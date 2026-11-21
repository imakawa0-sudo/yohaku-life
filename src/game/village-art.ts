import { getCraftDisplayTitle, getCraftSubject } from "./art-subject";
import { recordExperience } from "./life";
import { REGION_NPCS, regionShopOpen, villageContactProblem } from "./region";
import { sceneryName } from "./scenery";
import type { Command, CraftPiece, GameState, LifeExperience, LocationId } from "./types";

const trader = REGION_NPCS.find(npc => npc.id === "village-trader")!;
const day = (minutes: number) => Math.floor(minutes / 1440);
const isVillageDisplay = (event: LifeExperience) => event.kind === "display" && event.location === "village";

function differentView(s: GameState, first: CraftPiece, candidate: CraftPiece): boolean {
  const subject = getCraftSubject(s, candidate);
  return !!subject && subject.location !== getCraftSubject(s, first)?.location;
}

function reservedForSharing(s: GameState, craftId: number): boolean {
  return s.residents.some(resident => [resident.action, resident.suspended].some(action =>
    (action?.kind === "place-craft" && action.target === String(craftId)) || action?.topic?.craftId === craftId));
}

export type VillageArt = {
  first?: CraftPiece;
  companion?: CraftPiece;
  heardAt?: number;
  feedback?: string;
  choices: { craftId: number; title: string; createdAt: number }[];
  offerError?: string;
  listenError?: string;
};

/** The two places on the shop shelf belong to the artist. Merely opening the panel creates no facts. */
export function getVillageArt(s: GameState, residentId: string): VillageArt {
  const actor = s.residents.find(person => person.id === residentId);
  const own = (s.life?.crafts ?? []).filter(piece => piece.authorId === residentId);
  const entries = (s.life?.events ?? []).filter(event => event.actors.includes(residentId));
  const shown = entries.filter(isVillageDisplay).sort((a, b) => a.id - b.id);
  const first = own.find(piece => piece.id === shown[0]?.craftId);
  const companion = own.find(piece => piece.id === shown[1]?.craftId);
  const reply = entries.find(event => event.kind === "village-art-feedback");
  const contact = actor ? villageContactProblem(s, actor, trader) : "作者を一人選んでください。";
  const choices = own.filter(piece => piece.displayedAt === undefined && !reservedForSharing(s, piece.id)
    && (!first || differentView(s, first, piece))).map(piece => ({ craftId: piece.id, title: getCraftDisplayTitle(s, piece), createdAt: piece.createdAt }));
  let offerError = contact;
  let listenError = contact;
  if (!offerError) {
    if (companion) offerError = "店先にはもう二つの作品が並んでいます。";
    else if (first && !reply) offerError = "次の作品を預ける前に、翌日以降に商い手の感想を聞けます。";
    else if (!choices.length) offerError = first
      ? "別の場所で眺めた景色を題材にして、自分で彫った作品を持ってきてください。"
      : "手元にある自分の木彫りを持ってくると、店先に飾れます。";
  }
  if (!listenError) {
    if (!first) listenError = "先に自分の作品を店先に預けてください。";
    else if (reply) listenError = "この作品の感想はもう聞いています。";
    else if (day(s.minutes) <= day(first.displayedAt!)) listenError = "商い手に感想を聞けるのは、翌日以降の営業時間です。";
  }
  return { first, companion, heardAt: reply?.time, feedback: reply?.text, choices, offerError, listenError };
}

function shopkeeperReply(s: GameState, piece: CraftPiece): string {
  const subject = getCraftSubject(s, piece);
  const carving = piece.design === "flower" ? "花びらの縁" : "小鳥の背中";
  const detail: Partial<Record<LocationId, string>> = {
    reedbank: "細い彫り跡が揃ってる。この向き、風に倒れた葦の葉みたいだ。",
    meadow: "台に寝かせたら、彫り跡の間を水が走ってるように見えたよ。",
    ridge: "横から見ると輪郭がきゅっと立つね。尾根を歩く時の足元を思い出したよ。",
    road: "長い筋が二本残ってる。草の間から見え隠れする轍みたいだね。",
    ruins: "彫り残した角に影が落ちると、積んだ石の隙間が見えてくる。",
    shelter: "朝と昼で彫り跡の影がずれる。木陰で光が動くのとよく似てるよ。",
    village: "ここからの眺めを彫ったのかい。いつもの軒先を見直したくなるね。",
  };
  const generic = `朝の光が当たると、${carving}に彫り跡がよく見える。`;
  const impression = subject ? `${sceneryName(subject.location)}か。${detail[subject.location] ?? generic}` : generic;
  const another = subject ? "違う場所の景色" : "あなたが旅先で見た景色";
  return `商い手は木彫りを少し回した。「${impression}隣にもう一つ、${another}を置いてみたいね。どこを見てくるかは、あなたに任せるよ」`;
}

type VillageArtCommand = Extract<Command, { type: "exhibit-village-art" | "hear-village-art" }>;
export function applyVillageArt(s: GameState, cmd: VillageArtCommand): { event: LifeExperience } | { error: string } {
  const view = getVillageArt(s, cmd.residentId);
  const error = cmd.type === "hear-village-art" ? view.listenError : view.offerError;
  if (error) return { error };
  if (!Number.isSafeInteger(s.nextId + 2)) return { error: "作品の記録に使える番号が足りません。" };
  if (cmd.type === "hear-village-art") {
    const first = view.first!;
    return { event: recordExperience(s, "village-art-feedback", [cmd.residentId], {
      location: "village", craftId: first.id, text: shopkeeperReply(s, first),
    }) };
  }
  if (!view.choices.some(choice => choice.craftId === cmd.craftId)) return { error: "預けられる自分の作品を選んでください。" };
  const piece = s.life!.crafts.find(item => item.id === cmd.craftId)!;
  const name = s.residents.find(person => person.id === cmd.residentId)!.name;
  const title = getCraftDisplayTitle(s, piece);
  piece.displayedAt = s.minutes;
  piece.displayLocation = "village";
  const text = view.first
    ? `${name}が${title}を持ち帰った。商い手は店先に少し場所を空け、${getCraftDisplayTitle(s, view.first)}と並べた。「こうして見ると、二つとも違う顔をしてるね」`
    : `${name}は商い手に${title}を手渡し、何を思って彫ったかを話した。「ここなら朝の光が当たる。明日また顔を出してよ」。作品は集落の店先に飾られた。`;
  return { event: recordExperience(s, "display", [cmd.residentId], { location: "village", craftId: piece.id, text }) };
}

/** Reconstruct each artist's two displays and the actual return visit in the order they happened. */
export function validVillageArt(s: GameState): boolean {
  const artists = new Map<string, { first: CraftPiece; heardAt?: number; complete?: boolean }>();
  const entries = (s.life?.events ?? []).filter(event => isVillageDisplay(event) || event.kind === "village-art-feedback")
    .sort((a, b) => a.id - b.id);
  for (const event of entries) {
    const piece = s.life!.crafts.find(item => item.id === event.craftId);
    if (!piece || piece.displayLocation !== "village" || event.location !== "village" || !regionShopOpen(event.time)
      || event.actors.length !== 1 || event.actors[0] !== piece.authorId || !event.witnesses.includes(piece.authorId)
      || event.id <= piece.id || piece.createdAt > event.time || reservedForSharing(s, piece.id)) return false;
    const author = artists.get(piece.authorId);
    if (event.kind === "village-art-feedback") {
      if (!author || author.first !== piece || author.heardAt !== undefined || day(event.time) <= day(piece.displayedAt!)) return false;
      author.heardAt = event.time;
    } else {
      if (piece.displayedAt !== event.time) return false;
      if (!author) artists.set(piece.authorId, { first: piece });
      else {
        if (author.complete || author.heardAt === undefined || author.heardAt > event.time || !differentView(s, author.first, piece)) return false;
        author.complete = true;
      }
    }
  }
  return true;
}
