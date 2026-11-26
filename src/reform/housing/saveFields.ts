import { maxRoomHeight, roomWidth } from "../house";
import type { SpatialPoint } from "../spatial/types";

export function record(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}
export function fields(
  value: unknown,
  required: string[],
  optional: string[] = [],
): value is Record<string, unknown> {
  return (
    record(value) &&
    required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every(
      (key) => required.includes(key) || optional.includes(key),
    )
  );
}
export function integer(
  value: unknown,
  min: number,
  max = Number.MAX_SAFE_INTEGER,
): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= min &&
    value <= max
  );
}
export function point(value: unknown): value is SpatialPoint {
  return (
    fields(value, ["domainId", "cell"]) &&
    typeof value.domainId === "string" &&
    integer(value.cell, 0, roomWidth * maxRoomHeight - 1)
  );
}
