export interface GyroQuaternion {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface CubeGyroEvent {
  quaternion: GyroQuaternion;
  localTimestamp: number;
  raw?: unknown;
}

export type GyroHorizontalDirection = "idle" | "left" | "right";
export type GyroVerticalDirection = "idle" | "up" | "down";
export type GyroMouseMode = "desktop" | "game";
export const EXPERIMENTAL_GAME_MODE_ENABLED = false;

export interface GyroMouseConfig {
  enabled: boolean;
  mode: GyroMouseMode;
  deadzonePitchDeg: number;
  deadzoneRollDeg: number;
  fastPitchDeg: number;
  fastRollDeg: number;
  slowStepPx: number;
  fastStepPx: number;
  intervalMs: number;
  swapAxes: boolean;
  invertHorizontal: boolean;
  invertVertical: boolean;
}

export interface GyroMousePreviewState {
  basisReady: boolean;
  pitchDeg: number;
  rollDeg: number;
  horizontalDirection: GyroHorizontalDirection;
  verticalDirection: GyroVerticalDirection;
  stepX: number;
  stepY: number;
}

const STOP_RATIO = 0.72;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function lerp(start: number, end: number, ratio: number) {
  return start + (end - start) * ratio;
}

function smoothstep(value: number) {
  const x = clamp(value, 0, 1);
  return x * x * (3 - 2 * x);
}

export function createDefaultGyroMouseConfig(): GyroMouseConfig {
  return {
    enabled: false,
    mode: "desktop",
    deadzonePitchDeg: 15,
    deadzoneRollDeg: 15,
    fastPitchDeg: 30,
    fastRollDeg: 30,
    slowStepPx: 10,
    fastStepPx: 22,
    intervalMs: 20,
    swapAxes: false,
    invertHorizontal: false,
    invertVertical: false
  };
}

export function normalizeGyroMouseConfig(input?: Partial<GyroMouseConfig> | null): GyroMouseConfig {
  const defaults = createDefaultGyroMouseConfig();
  const next = {
    ...defaults,
    ...input
  };

  return {
    enabled: Boolean(next.enabled),
    mode: EXPERIMENTAL_GAME_MODE_ENABLED && next.mode === "game" ? "game" : "desktop",
    deadzonePitchDeg: clamp(Number(next.deadzonePitchDeg) || defaults.deadzonePitchDeg, 4, 75),
    deadzoneRollDeg: clamp(Number(next.deadzoneRollDeg) || defaults.deadzoneRollDeg, 4, 75),
    fastPitchDeg: clamp(Number(next.fastPitchDeg) || defaults.fastPitchDeg, 6, 89),
    fastRollDeg: clamp(Number(next.fastRollDeg) || defaults.fastRollDeg, 6, 89),
    slowStepPx: clamp(Number(next.slowStepPx) || defaults.slowStepPx, 1, 80),
    fastStepPx: clamp(Number(next.fastStepPx) || defaults.fastStepPx, 1, 120),
    intervalMs: clamp(Number(next.intervalMs) || defaults.intervalMs, 10, 80),
    swapAxes: Boolean(next.swapAxes),
    invertHorizontal: Boolean(next.invertHorizontal),
    invertVertical: Boolean(next.invertVertical)
  };
}

export function normalizeQuaternion(input: GyroQuaternion): GyroQuaternion {
  const magnitude = Math.hypot(input.x, input.y, input.z, input.w) || 1;
  return {
    x: input.x / magnitude,
    y: input.y / magnitude,
    z: input.z / magnitude,
    w: input.w / magnitude
  };
}

export function conjugateQuaternion(input: GyroQuaternion): GyroQuaternion {
  return {
    x: -input.x,
    y: -input.y,
    z: -input.z,
    w: input.w
  };
}

export function multiplyQuaternions(a: GyroQuaternion, b: GyroQuaternion): GyroQuaternion {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w
  };
}

export function createGyroBasis(quaternion: GyroQuaternion) {
  return conjugateQuaternion(normalizeQuaternion(quaternion));
}

function quaternionToPitchRollDegrees(quaternion: GyroQuaternion) {
  const q = normalizeQuaternion(quaternion);
  const sinRoll = 2 * (q.w * q.x + q.y * q.z);
  const cosRoll = 1 - 2 * (q.x * q.x + q.y * q.y);
  const rollDeg = Math.atan2(sinRoll, cosRoll) * 180 / Math.PI;

  const sinPitch = 2 * (q.w * q.y - q.z * q.x);
  const pitchDeg = Math.asin(clamp(sinPitch, -1, 1)) * 180 / Math.PI;

  return { pitchDeg, rollDeg };
}

function resolveAxisDirection<TNegative extends string, TPositive extends string>(
  valueDeg: number,
  deadzoneDeg: number,
  previous: "idle" | TNegative | TPositive,
  negative: TNegative,
  positive: TPositive
) {
  const stopThreshold = deadzoneDeg * STOP_RATIO;

  if (previous === negative) {
    return valueDeg <= -stopThreshold ? negative : "idle";
  }

  if (previous === positive) {
    return valueDeg >= stopThreshold ? positive : "idle";
  }

  if (valueDeg <= -deadzoneDeg) {
    return negative;
  }

  if (valueDeg >= deadzoneDeg) {
    return positive;
  }

  return "idle";
}

function resolveStep(valueDeg: number, fastThresholdDeg: number, slowStepPx: number, fastStepPx: number) {
  return Math.abs(valueDeg) >= fastThresholdDeg ? fastStepPx : slowStepPx;
}

function resolveGameStep(
  valueDeg: number,
  direction: "idle" | "left" | "right" | "up" | "down",
  deadzoneDeg: number,
  fastThresholdDeg: number,
  slowStepPx: number,
  fastStepPx: number
) {
  if (direction === "idle") {
    return 0;
  }

  const magnitude = Math.abs(valueDeg);
  const cappedFastThreshold = Math.max(fastThresholdDeg, deadzoneDeg + 1);
  const rampRatio = smoothstep((magnitude - deadzoneDeg) / (cappedFastThreshold - deadzoneDeg));
  const overdriveRatio = smoothstep((magnitude - cappedFastThreshold) / Math.max(12, cappedFastThreshold * 0.85));
  const baseStep = Math.max(0.6, slowStepPx * 0.22);
  const cruiseStep = Math.max(baseStep, fastStepPx * 0.82);
  const maxStep = Math.max(cruiseStep, fastStepPx * 1.7);
  const step = lerp(baseStep, cruiseStep, rampRatio) + (maxStep - cruiseStep) * overdriveRatio;
  const sign = direction === "right" || direction === "down" ? 1 : -1;

  return sign * step;
}

export function evaluateGyroMouse(
  basis: GyroQuaternion,
  quaternion: GyroQuaternion,
  config: GyroMouseConfig,
  previous: Pick<GyroMousePreviewState, "horizontalDirection" | "verticalDirection">
): GyroMousePreviewState {
  const relative = multiplyQuaternions(basis, normalizeQuaternion(quaternion));
  let { pitchDeg, rollDeg } = quaternionToPitchRollDegrees(relative);

  if (config.swapAxes) {
    [pitchDeg, rollDeg] = [rollDeg, pitchDeg];
  }

  if (config.invertVertical) {
    pitchDeg *= -1;
  }

  if (config.invertHorizontal) {
    rollDeg *= -1;
  }

  const horizontalDirection = resolveAxisDirection(
    rollDeg,
    config.deadzoneRollDeg,
    previous.horizontalDirection,
    "left",
    "right"
  );
  const verticalDirection = resolveAxisDirection(
    pitchDeg,
    config.deadzonePitchDeg,
    previous.verticalDirection,
    "up",
    "down"
  );

  const stepX = config.mode === "game"
    ? resolveGameStep(
        rollDeg,
        horizontalDirection,
        config.deadzoneRollDeg,
        config.fastRollDeg,
        config.slowStepPx,
        config.fastStepPx
      )
    : horizontalDirection === "idle"
      ? 0
      : (horizontalDirection === "right" ? 1 : -1)
        * resolveStep(rollDeg, config.fastRollDeg, config.slowStepPx, config.fastStepPx);

  const stepY = config.mode === "game"
    ? resolveGameStep(
        pitchDeg,
        verticalDirection,
        config.deadzonePitchDeg,
        config.fastPitchDeg,
        config.slowStepPx,
        config.fastStepPx
      )
    : verticalDirection === "idle"
      ? 0
      : (verticalDirection === "down" ? 1 : -1)
        * resolveStep(pitchDeg, config.fastPitchDeg, config.slowStepPx, config.fastStepPx);

  return {
    basisReady: true,
    pitchDeg,
    rollDeg,
    horizontalDirection,
    verticalDirection,
    stepX,
    stepY
  };
}

export function createIdleGyroPreviewState(): GyroMousePreviewState {
  return {
    basisReady: false,
    pitchDeg: 0,
    rollDeg: 0,
    horizontalDirection: "idle",
    verticalDirection: "idle",
    stepX: 0,
    stepY: 0
  };
}
