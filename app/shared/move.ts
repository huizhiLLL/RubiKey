export const ALL_MOVES = [
  "U",
  "U'",
  "U2",
  "R",
  "R'",
  "R2",
  "F",
  "F'",
  "F2",
  "D",
  "D'",
  "D2",
  "L",
  "L'",
  "L2",
  "B",
  "B'",
  "B2"
] as const;

export type MoveToken = (typeof ALL_MOVES)[number];

export interface CubeMoveEvent {
  move: MoveToken;
  localTimestamp: number;
  deviceTimestamp?: number;
  raw?: unknown;
}