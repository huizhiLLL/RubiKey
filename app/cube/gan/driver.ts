import type { CubeMoveEvent } from "../../shared/move";
import { normalizeMac, promptForMacAddress, readAdvertisementValue, rememberMac } from "../core/mac";
import type { CubeConnectionOptions, CubeModelRegistration, DebugListener, MoveListener, SmartCubeDriver } from "../core/types";
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

  getDeviceInfo() {
    return {
      brand: "gan" as const,
      protocol: this.protocol,
      deviceName: this.getDeviceName(),
      macAddress: this.getMacAddress()
    };
  }

  async connect(device: BluetoothDevice, options?: CubeConnectionOptions) {
    this.device = device;
    this.device.addEventListener("gattserverdisconnected", this.handleDisconnect);
    this.debug("info", `Selected device: ${device.name ?? "Unknown device"}`);

    const manualMac = normalizeMac(options?.preferredMac ?? null);
    if (manualMac) {
      this.macAddress = manualMac;
      rememberMac(manualMac);
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
    const mac = await readAdvertisementValue(device, (event) => {
      for (const [, dataView] of event.manufacturerData) {
        const candidate = this.extractMacAddress(dataView);
        if (candidate) {
          return candidate;
        }
      }
      return null;
    });

    if (mac) {
      rememberMac(mac);
    }
    return mac;
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
    return promptForMacAddress("GAN");
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

export const GAN_CUBE_MODEL: CubeModelRegistration = {
  brand: "gan",
  prefixes: GAN_NAME_PREFIXES,
  optionalServices: GAN_OPTIONAL_SERVICES,
  createDriver: () => new GanCubeDriver()
};
