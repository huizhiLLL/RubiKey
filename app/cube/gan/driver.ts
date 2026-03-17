import type { CubeMoveEvent } from "../../shared/move";
import { GanPacketParser } from "./parser";
import {
  bytesToHex,
  GAN_NAME_PREFIXES,
  GAN_OPTIONAL_SERVICES,
  GAN_UUIDS,
  normalizeUuid,
  type GanDebugEntry,
  type GanProtocolVersion
} from "./protocol";

export type MoveListener = (event: CubeMoveEvent) => void;
export type DebugListener = (entry: GanDebugEntry) => void;

export interface SmartCubeDriver {
  connect(options?: { preferredMac?: string | null }): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  setMoveListener(listener: MoveListener): void;
}

const MAC_ADDRESS_PATTERN = /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/i;

export class GanCubeDriver implements SmartCubeDriver {
  private device: BluetoothDevice | null = null;
  private gatt: BluetoothRemoteGATTServer | null = null;
  private readCharacteristic: BluetoothRemoteGATTCharacteristic | null = null;
  private writeCharacteristic: BluetoothRemoteGATTCharacteristic | null = null;
  private moveListener: MoveListener = () => undefined;
  private debugListener: DebugListener = () => undefined;
  private parser = new GanPacketParser();
  private protocol: GanProtocolVersion = "unknown";
  private macAddress: string | null = null;
  private boundNotificationHandler = (event: Event) => {
    const target = event.target as BluetoothRemoteGATTCharacteristic | null;
    if (!target?.value) {
      return;
    }
    const { debug, moves } = this.parser.parseNotification(this.protocol, target.value);
    debug.forEach((entry) => this.debugListener(entry));
    moves.forEach((move) => this.moveListener(move));
  };

  setMoveListener(listener: MoveListener) {
    this.moveListener = listener;
  }

  setDebugListener(listener: DebugListener) {
    this.debugListener = listener;
  }

  isConnected() {
    return Boolean(this.device?.gatt?.connected);
  }

  getProtocol() {
    return this.protocol;
  }

  getDeviceName() {
    return this.device?.name ?? null;
  }

  getMacAddress() {
    return this.macAddress;
  }

  async connect(options?: { preferredMac?: string | null }) {
    this.debug("info", "Opening Bluetooth device chooser...");
    const device = await navigator.bluetooth.requestDevice({
      filters: GAN_NAME_PREFIXES.map((namePrefix) => ({ namePrefix })),
      optionalServices: [...GAN_OPTIONAL_SERVICES]
    });

    this.device = device;
    this.device.addEventListener("gattserverdisconnected", this.handleDisconnect);
    this.debug("info", `Selected device: ${device.name ?? "Unknown device"}`);

    const manualMac = this.normalizeMac(options?.preferredMac ?? null);
    if (manualMac) {
      this.macAddress = manualMac;
      this.debug("info", `Using manually provided MAC: ${manualMac}`);
    } else {
      this.macAddress = await this.tryReadMacAddress(device);
      if (!this.macAddress) {
        this.debug("warn", "Could not read device MAC from advertisements.");
        this.macAddress = this.promptForMacAddress();
      }

      if (this.macAddress) {
        this.debug("info", `Using MAC: ${this.macAddress}`);
      } else {
        this.debug("warn", "No MAC available. GAN packet decryption will likely fail.");
      }
    }

    this.gatt = await device.gatt?.connect() ?? null;
    if (!this.gatt) {
      throw new Error("Failed to connect to GATT server.");
    }

    const services = await this.gatt.getPrimaryServices();
    const serviceIds = services.map((service: BluetoothRemoteGATTService) => normalizeUuid(service.uuid));
    this.debug("info", `Discovered services: ${serviceIds.join(", ")}`);

    if (serviceIds.includes(normalizeUuid(GAN_UUIDS.v2Service))) {
      await this.initializeV2(services);
      return;
    }

    if (serviceIds.includes(normalizeUuid(GAN_UUIDS.v3Service))) {
      await this.initializeV3(services);
      return;
    }

    if (serviceIds.includes(normalizeUuid(GAN_UUIDS.v4Service))) {
      await this.initializeV4(services);
      return;
    }

    this.protocol = "unknown";
    this.debug("warn", "Supported GAN protocol service was not detected.");
    throw new Error("GAN protocol service was not detected on this device.");
  }

  async disconnect() {
    if (this.readCharacteristic) {
      this.readCharacteristic.removeEventListener("characteristicvaluechanged", this.boundNotificationHandler);
      try {
        await this.readCharacteristic.stopNotifications();
      } catch {
        // ignore stop notification errors during teardown
      }
    }

    if (this.device) {
      this.device.removeEventListener("gattserverdisconnected", this.handleDisconnect);
    }

    if (this.gatt?.connected) {
      this.gatt.disconnect();
    }

    this.readCharacteristic = null;
    this.writeCharacteristic = null;
    this.gatt = null;
    this.device = null;
    this.protocol = "unknown";
    this.macAddress = null;
    this.debug("info", "Disconnected from GAN device.");
  }

  private handleDisconnect = () => {
    this.debug("warn", "Bluetooth device disconnected.");
    this.readCharacteristic = null;
    this.writeCharacteristic = null;
    this.gatt = null;
  };

  private async initializeV2(services: BluetoothRemoteGATTService[]) {
    this.protocol = "v2";
    this.parser.configure(this.macAddress, (this.getDeviceName() ?? "").startsWith("AiCube") ? 1 : 0);
    const service = this.findService(services, GAN_UUIDS.v2Service);
    const characteristics = await service.getCharacteristics();
    this.readCharacteristic = this.findCharacteristic(characteristics, GAN_UUIDS.v2Read);
    this.writeCharacteristic = this.findCharacteristic(characteristics, GAN_UUIDS.v2Write);
    await this.startListening();
    await this.sendRequest([4, ...new Array(19).fill(0)]);
    await this.sendRequest([9, ...new Array(19).fill(0)]);
    this.debug("info", "GAN v2 connection initialized.");
  }

  private async initializeV3(services: BluetoothRemoteGATTService[]) {
    this.protocol = "v3";
    this.parser.configure(this.macAddress, 0);
    const service = this.findService(services, GAN_UUIDS.v3Service);
    const characteristics = await service.getCharacteristics();
    this.readCharacteristic = this.findCharacteristic(characteristics, GAN_UUIDS.v3Read);
    this.writeCharacteristic = this.findCharacteristic(characteristics, GAN_UUIDS.v3Write);
    await this.startListening();
    await this.sendRequest([0x68, 0x04, ...new Array(14).fill(0)]);
    await this.sendRequest([0x68, 0x01, ...new Array(14).fill(0)]);
    await this.sendRequest([0x68, 0x07, ...new Array(14).fill(0)]);
    this.debug("info", "GAN v3 connection initialized.");
  }

  private async initializeV4(services: BluetoothRemoteGATTService[]) {
    this.protocol = "v4";
    this.parser.configure(this.macAddress, 0);
    const service = this.findService(services, GAN_UUIDS.v4Service);
    const characteristics = await service.getCharacteristics();
    this.readCharacteristic = this.findCharacteristic(characteristics, GAN_UUIDS.v4Read);
    this.writeCharacteristic = this.findCharacteristic(characteristics, GAN_UUIDS.v4Write);
    await this.startListening();
    await this.sendRequest([0xdf, 0x03, 0x00, 0x00, ...new Array(16).fill(0)]);
    await this.sendRequest([0xdd, 0x04, 0x00, 0xed, ...new Array(16).fill(0)]);
    await this.sendRequest([0xdd, 0x04, 0x00, 0xef, ...new Array(16).fill(0)]);
    this.debug("info", "GAN v4 connection initialized.");
  }

  private async startListening() {
    if (!this.readCharacteristic) {
      throw new Error("Read characteristic is missing.");
    }
    this.readCharacteristic.addEventListener("characteristicvaluechanged", this.boundNotificationHandler);
    await this.readCharacteristic.startNotifications();
    this.debug("info", `Started notifications on ${this.protocol} read characteristic.`);
  }

  private async sendRequest(payload: number[]) {
    if (!this.writeCharacteristic) {
      return;
    }
    const data = this.parser.encodeRequest(payload);
    this.debug("tx", `Sent ${this.protocol} request`, bytesToHex(Array.from(data)), this.protocol);
    await this.writeCharacteristic.writeValue(data);
  }

  private findService(services: BluetoothRemoteGATTService[], uuid: string) {
    const service = services.find((item) => normalizeUuid(item.uuid) === normalizeUuid(uuid));
    if (!service) {
      throw new Error(`Could not find service ${uuid}.`);
    }
    return service;
  }

  private findCharacteristic(characteristics: BluetoothRemoteGATTCharacteristic[], uuid: string) {
    const characteristic = characteristics.find(
      (item) => normalizeUuid(item.uuid) === normalizeUuid(uuid)
    );
    if (!characteristic) {
      throw new Error(`Could not find characteristic ${uuid}.`);
    }
    return characteristic;
  }

  private async tryReadMacAddress(device: BluetoothDevice) {
    if (!device.watchAdvertisements) {
      return null;
    }

    return new Promise<string | null>((resolve) => {
      const timeoutId = window.setTimeout(() => {
        cleanup();
        resolve(null);
      }, 8000);

      const onAdvertisement = (event: BluetoothAdvertisingEvent) => {
        const manufacturerData = event.manufacturerData;
        for (const [, dataView] of manufacturerData) {
          const mac = this.extractMacAddress(dataView);
          if (mac) {
            cleanup();
            resolve(mac);
            return;
          }
        }
      };

      const cleanup = () => {
        window.clearTimeout(timeoutId);
        device.removeEventListener("advertisementreceived", onAdvertisement as EventListener);
      };

      device.addEventListener("advertisementreceived", onAdvertisement as EventListener);
      void device.watchAdvertisements?.();
    });
  }

  private extractMacAddress(dataView: DataView) {
    if (dataView.byteLength < 6) {
      return null;
    }
    const bytes: string[] = [];
    for (let index = 0; index < 6; index += 1) {
      bytes.push((dataView.getUint8(dataView.byteLength - index - 1) + 0x100).toString(16).slice(1));
    }
    return bytes.join(":").toUpperCase();
  }

  private promptForMacAddress() {
    const remembered = window.localStorage.getItem("rubikey.gan.mac") ?? "";
    const value = window.prompt(
      "GAN MAC address was not detected automatically. Enter the cube MAC address to enable packet decryption.",
      remembered || "AA:BB:CC:DD:EE:FF"
    );

    return this.normalizeMac(value);
  }

  private normalizeMac(value: string | null) {
    if (!value) {
      return null;
    }

    const normalized = value.trim().toUpperCase().replace(/-/g, ":");
    if (!MAC_ADDRESS_PATTERN.test(normalized)) {
      this.debug("error", `Invalid MAC address: ${value}`);
      return null;
    }

    window.localStorage.setItem("rubikey.gan.mac", normalized);
    return normalized;
  }

  private debug(kind: GanDebugEntry["kind"], message: string, hex?: string, protocol?: GanProtocolVersion) {
    this.debugListener({
      kind,
      message,
      hex,
      protocol,
      timestamp: Date.now()
    });
  }
}