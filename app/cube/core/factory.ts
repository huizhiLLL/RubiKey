import type { CubeConnectionOptions, CubeDebugEntry, CubeDeviceInfo, CubeModelRegistration, DebugListener, MoveListener, SmartCubeDriver } from "./types";
import { uniqueNumbers, uniqueStrings } from "./utils";

export class SmartCubeConnector {
  private currentDriver: SmartCubeDriver | null = null;
  private moveListener: MoveListener = () => undefined;
  private debugListener: DebugListener = () => undefined;

  constructor(private readonly models: CubeModelRegistration[]) {}

  setMoveListener(listener: MoveListener) {
    this.moveListener = listener;
    this.currentDriver?.setMoveListener(listener);
  }

  setDebugListener(listener: DebugListener) {
    this.debugListener = listener;
    this.currentDriver?.setDebugListener(listener);
  }

  isConnected() {
    return this.currentDriver?.isConnected() ?? false;
  }

  getDeviceInfo(): CubeDeviceInfo {
    return this.currentDriver?.getDeviceInfo() ?? {
      brand: "unknown",
      protocol: "unknown",
      deviceName: null,
      macAddress: null
    };
  }

  async connect(options?: CubeConnectionOptions) {
    this.debug({
      kind: "info",
      message: "Opening Bluetooth device chooser...",
      timestamp: Date.now()
    });

    const filters = this.models.flatMap((model) => model.prefixes.map((prefix) => ({ namePrefix: prefix })));
    const optionalServices = uniqueStrings(this.models.flatMap((model) => [...model.optionalServices]));
    const optionalManufacturerData = uniqueNumbers(
      this.models.flatMap((model) => [...(model.optionalManufacturerData ?? [])])
    );

    const requestOptions = {
      filters,
      optionalServices,
      ...(optionalManufacturerData.length > 0 ? { optionalManufacturerData } : {})
    } as RequestDeviceOptions & { optionalManufacturerData?: number[] };

    const device = await navigator.bluetooth.requestDevice(requestOptions);
    const matchedModel = this.models.find((model) => model.prefixes.some((prefix) => (device.name ?? "").startsWith(prefix)));
    if (!matchedModel) {
      throw new Error("Cannot detect supported smart cube type from selected device.");
    }

    await this.currentDriver?.disconnect();

    const driver = matchedModel.createDriver();
    driver.setMoveListener(this.moveListener);
    driver.setDebugListener((entry) => {
      this.debug({
        ...entry,
        brand: entry.brand ?? matchedModel.brand
      });
    });

    this.currentDriver = driver;
    await driver.connect(device, options);
  }

  async disconnect() {
    await this.currentDriver?.disconnect();
  }

  private debug(entry: CubeDebugEntry) {
    this.debugListener(entry);
  }
}
