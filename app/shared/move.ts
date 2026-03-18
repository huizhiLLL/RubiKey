export const ALL_MOVES = [
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
] as const;

export type MoveToken = (typeof ALL_MOVES)[number];

export interface CubeMoveEvent {
  move: MoveToken;
  localTimestamp: number;
  deviceTimestamp?: number;
  raw?: unknown;
}
