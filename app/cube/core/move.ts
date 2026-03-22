import type { MoveToken } from "@shared/move";

const SUPPORTED_MOVE_SET = new Set<MoveToken>([
  "U",
  "U'",
  "R",
  "R'",
  "F",
  "F'",
  "D",
  "D'",
  "L",
  "L'",
  "B",
  "B'"
]);

export function toSupportedMoveToken(value: string): MoveToken | null {
  return SUPPORTED_MOVE_SET.has(value as MoveToken) ? value as MoveToken : null;
}

export function moveTokenFromAxisAndPow(axis: number, pow: number): MoveToken | null {
  if (axis < 0 || axis >= 6) {
    return null;
  }

  const face = "URFDLB".charAt(axis);
  if (pow === 0) {
    return toSupportedMoveToken(face);
  }
  if (pow === 1) {
    return toSupportedMoveToken(`${face}'`);
  }
  return null;
}
