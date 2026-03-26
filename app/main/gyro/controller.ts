import { Point, mouse } from "@nut-tree/nut-js";
import {
  createGyroBasis,
  createIdleGyroPreviewState,
  evaluateGyroMouse,
  normalizeGyroMouseConfig,
  type CubeGyroEvent,
  type GyroMouseConfig,
  type GyroMousePreviewState,
  type GyroQuaternion
} from "../../shared/gyro.js";

export class GyroMouseController {
  private config: GyroMouseConfig = normalizeGyroMouseConfig();
  private systemEnabled = true;
  private deviceSupported = false;
  private basis: GyroQuaternion | null = null;
  private previewState: GyroMousePreviewState = createIdleGyroPreviewState();
  private movementTimer: NodeJS.Timeout | null = null;
  private movementQueue: Promise<void> = Promise.resolve();
  private pendingMoveX = 0;
  private pendingMoveY = 0;
  private gameVelocityX = 0;
  private gameVelocityY = 0;

  setConfig(config: GyroMouseConfig) {
    this.config = normalizeGyroMouseConfig(config);
    this.stopLoop();
    this.resetMotionState();
    this.syncLoop();
  }

  setSystemEnabled(enabled: boolean) {
    this.systemEnabled = enabled;
    if (!enabled) {
      this.resetMotionState();
    }
    this.syncLoop();
  }

  setDeviceSupported(supported: boolean) {
    this.deviceSupported = supported;
    if (!supported) {
      this.clearDevice();
      return;
    }
    this.syncLoop();
  }

  handleGyroEvent(event: CubeGyroEvent) {
    if (!this.deviceSupported || !this.systemEnabled || !this.config.enabled) {
      return;
    }

    if (!this.basis) {
      this.basis = createGyroBasis(event.quaternion);
      this.previewState = {
        ...createIdleGyroPreviewState(),
        basisReady: true
      };
      this.syncLoop();
      return;
    }

    this.previewState = evaluateGyroMouse(this.basis, event.quaternion, this.config, this.previewState);
    this.syncLoop();
  }

  resetNeutral() {
    this.basis = null;
    this.previewState = createIdleGyroPreviewState();
    this.resetMotionState();
    this.stopLoop();
  }

  clearDevice() {
    this.deviceSupported = false;
    this.resetNeutral();
  }

  emergencyStop() {
    this.resetMotionState();
    this.stopLoop();
  }

  private shouldMove() {
    return this.deviceSupported
      && this.systemEnabled
      && this.config.enabled
      && this.previewState.basisReady
      && (
        this.previewState.stepX !== 0
        || this.previewState.stepY !== 0
        || this.hasResidualMotion()
      );
  }

  private syncLoop() {
    if (this.shouldMove()) {
      this.startLoop();
      return;
    }
    this.stopLoop();
  }

  private startLoop() {
    if (this.movementTimer) {
      return;
    }

    this.movementTimer = setInterval(() => {
      if (!this.shouldMove()) {
        this.stopLoop();
        return;
      }

      const { emitX, emitY } = this.config.mode === "game"
        ? this.resolveGameEmitDelta()
        : this.resolveDesktopEmitDelta();

      if (emitX === 0 && emitY === 0) {
        return;
      }

      this.movementQueue = this.movementQueue
        .then(async () => {
          const position = await mouse.getPosition();
          await mouse.setPosition(new Point(
            Math.max(0, position.x + emitX),
            Math.max(0, position.y + emitY)
          ));
        })
        .catch(() => undefined);
    }, this.getLoopInterval());
  }

  private stopLoop() {
    if (this.movementTimer) {
      clearInterval(this.movementTimer);
      this.movementTimer = null;
    }
  }

  private getLoopInterval() {
    return this.config.mode === "game"
      ? Math.max(10, Math.min(this.config.intervalMs, 16))
      : this.config.intervalMs;
  }

  private hasResidualMotion() {
    return this.config.mode === "game"
      && (
        Math.abs(this.pendingMoveX) >= 1
        || Math.abs(this.pendingMoveY) >= 1
        || Math.abs(this.gameVelocityX) >= 0.08
        || Math.abs(this.gameVelocityY) >= 0.08
      );
  }

  private resetMotionState() {
    this.pendingMoveX = 0;
    this.pendingMoveY = 0;
    this.gameVelocityX = 0;
    this.gameVelocityY = 0;
  }

  private resolveDesktopEmitDelta() {
    const { stepX, stepY } = this.previewState;
    this.pendingMoveX += stepX;
    this.pendingMoveY += stepY;

    return {
      emitX: this.consumePendingDelta("x"),
      emitY: this.consumePendingDelta("y")
    };
  }

  private resolveGameEmitDelta() {
    // Game mode uses a smoothed velocity model so small tilts feel continuous
    // instead of collapsing into the same pulse behavior as keyboard-like input.
    this.gameVelocityX = this.blendGameVelocity(this.gameVelocityX, this.previewState.stepX);
    this.gameVelocityY = this.blendGameVelocity(this.gameVelocityY, this.previewState.stepY);

    this.pendingMoveX += this.gameVelocityX;
    this.pendingMoveY += this.gameVelocityY;

    if (this.previewState.stepX === 0 && this.gameVelocityX === 0 && Math.abs(this.pendingMoveX) < 1) {
      this.pendingMoveX = 0;
    }

    if (this.previewState.stepY === 0 && this.gameVelocityY === 0 && Math.abs(this.pendingMoveY) < 1) {
      this.pendingMoveY = 0;
    }

    return {
      emitX: this.consumePendingDelta("x"),
      emitY: this.consumePendingDelta("y")
    };
  }

  private blendGameVelocity(current: number, target: number) {
    if (target === 0) {
      const next = current * 0.58;
      return Math.abs(next) < 0.08 ? 0 : next;
    }

    const sameDirection = current === 0 || Math.sign(current) === Math.sign(target);
    const blendRatio = sameDirection
      ? (Math.abs(target) > Math.abs(current) ? 0.28 : 0.18)
      : 0.42;

    return current + (target - current) * blendRatio;
  }

  private consumePendingDelta(axis: "x" | "y") {
    const pending = axis === "x" ? this.pendingMoveX : this.pendingMoveY;
    const emit = pending > 0 ? Math.floor(pending) : Math.ceil(pending);
    if (axis === "x") {
      this.pendingMoveX -= emit;
    } else {
      this.pendingMoveY -= emit;
    }
    return emit;
  }
}
