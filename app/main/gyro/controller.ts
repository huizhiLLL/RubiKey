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

  setConfig(config: GyroMouseConfig) {
    this.config = normalizeGyroMouseConfig(config);
    this.syncLoop();
  }

  setSystemEnabled(enabled: boolean) {
    this.systemEnabled = enabled;
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
    this.stopLoop();
  }

  clearDevice() {
    this.deviceSupported = false;
    this.resetNeutral();
  }

  emergencyStop() {
    this.stopLoop();
  }

  private shouldMove() {
    return this.deviceSupported
      && this.systemEnabled
      && this.config.enabled
      && this.previewState.basisReady
      && (this.previewState.stepX !== 0 || this.previewState.stepY !== 0);
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

      const { stepX, stepY } = this.previewState;
      this.movementQueue = this.movementQueue
        .then(async () => {
          const position = await mouse.getPosition();
          await mouse.setPosition(new Point(
            Math.max(0, position.x + stepX),
            Math.max(0, position.y + stepY)
          ));
        })
        .catch(() => undefined);
    }, this.config.intervalMs);
  }

  private stopLoop() {
    if (this.movementTimer) {
      clearInterval(this.movementTimer);
      this.movementTimer = null;
    }
  }
}
