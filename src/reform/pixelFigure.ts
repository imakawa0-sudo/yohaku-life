import type { Persona } from "./peopleModel";
import { drawCharacter } from "./characterArt";

// Keep the drawing API used by the maker, profiles and scenery.
export { walkerWidth, walkerHeight } from "./characterArt";

export function drawPortrait(ctx: CanvasRenderingContext2D, person: Persona) {
  drawCharacter(ctx, person.appearance, "portrait");
}

export function drawWalker(ctx: CanvasRenderingContext2D, person: Persona) {
  drawCharacter(ctx, person.appearance, "walker");
}
