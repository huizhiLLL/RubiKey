import type { CubeConnectionOptions, CubeModelRegistration, DebugListener, MoveListener, SmartCubeDriver } from "../core/types";
import { normalizeMac, promptForMacAddress, readAdvertisementValue, rememberMac } from "../core/mac";
import { Moyu32PacketParser } from "./parser";
import {
  bytesToHex,
  MOYU32_CIC_LIST,
  MOYU32_NAME_PREFIXES,
  MOYU32_OPTIONAL_SERVICES,
  MOYU32_UUIDS,
  normalizeUuid,
  type Moyu32DebugEntry,
  type Moyu32ProtocolVersion
} from "./protocol";

export class Moyu32CubeDriver implements SmartCubeDriver {
  private device: BluetoothDevice | null = null;
  private gatt: BluetoothRemoteGATTServer | null = null;
  private readCharacteristic: BluetoothRemoteGATTCharacteristic | null = null;
  private writeCharacteristic: BluetoothRemoteGATTCharacteristic | null = null;
  private moveListener: MoveListener = () => undefined;
  private debugListener: DebugListener = () => undefined;
  private parser = new Moyu32PacketParser();
  private protocol: Moyu32ProtocolVersion = "unknown";
  private macAddress: string | null = null;
  private boundNotificationHandler = (event: Event) => {
    const target = event.target as BluetoothRemoteGATTCharacteristic | null;
    if (!target?.value) {
      return;
    }
    const { debug, moves } = this.parser.parseNotification(this.protocol, target.value);
    debug.forEach((entry) => this.debug(entry.kind, entry.message, entry.hex, entry.protocol));
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

  getDeviceInfo() {
    return {
      brand: "moyu32" as const,
      protocol: this.protocol,
      deviceName: this.device?.name ?? null,
      macAddress: this.macAddress
    };
  }

  async connect(device: BluetoothDevice, options?: CubeConnectionOptions) {
    this.device = device;
    this.protocol = "moyu32";
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
        this.debug("warn", "No MAC available. Moyu32 packet decryption will likely fail.");
      }
    }

    this.parser.configure(this.macAddress);

    this.gatt = await device.gatt?.connect() ?? null;
    if (!this.gatt) {
      throw new Error("Failed to connect to Moyu32 GATT server.");
    }

    const services = await this.gatt.getPrimaryServices();
    const service = services.find((item) => normalizeUuid(item.uuid) === normalizeUuid(MOYU32_UUIDS.service));
    if (!service) {
      throw new Error(`Could not find service ${MOYU32_UUIDS.service}.`);
    }

    const characteristics = await service.getCharacteristics();
    this.readCharacteristic = this.findCharacteristic(characteristics, MOYU32_UUIDS.read);
    this.writeCharacteristic = this.findCharacteristic(characteristics, MOYU32_UUIDS.write);

    await this.startListening();
    await this.sendSimpleRequest(161);
    await this.sendSimpleRequest(163);
    await this.sendSimpleRequest(164);
    this.debug("info", "Moyu32 connection initialized.");
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
    this.debug("info", "Disconnected from Moyu32 device.");
  }

  private handleDisconnect = () => {
    this.debug("warn", "Bluetooth device disconnected.");
    this.readCharacteristic = null;
    this.writeCharacteristic = null;
    this.gatt = null;
  };

  private async tryReadMacAddress(device: BluetoothDevice) {
    const mac = await readAdvertisementValue(device, (event) => {
      const dataView = this.extractManufacturerData(event.manufacturerData);
      return dataView ? this.extractMacAddress(dataView) : null;
    }, 10000);

    if (mac) {
      rememberMac(mac);
    }
    return mac;
  }

  private extractManufacturerData(manufacturerData: Map<number, DataView>) {
    for (const cic of MOYU32_CIC_LIST) {
      const dataView = manufacturerData.get(cic);
      if (dataView) {
        return dataView;
      }
    }
    return null;
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
    return promptForMacAddress("Moyu32");
  }

  private async startListening() {
    if (!this.readCharacteristic) {
      throw new Error("Moyu32 read characteristic is missing.");
    }
    this.readCharacteristic.addEventListener("characteristicvaluechanged", this.boundNotificationHandler);
    await this.readCharacteristic.startNotifications();
    this.debug("info", "Started notifications on Moyu32 read characteristic.");
  }

  private async sendSimpleRequest(opcode: number) {
    const payload = new Array(20).fill(0);
    payload[0] = opcode;
    await this.sendRequest(payload);
  }

  private async sendRequest(payload: number[]) {
    if (!this.writeCharacteristic) {
      return;
    }
    const data = this.parser.encodeRequest(payload);
    this.debug("tx", `Sent ${this.protocol} request`, bytesToHex(Array.from(data)), this.protocol);
    await this.writeCharacteristic.writeValue(data);
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

  private debug(kind: Moyu32DebugEntry["kind"], message: string, hex?: string, protocol?: string) {
    this.debugListener({
      kind,
      message,
      hex,
      protocol,
      brand: "moyu32",
      timestamp: Date.now()
    });
  }
}

export const MOYU32_CUBE_MODEL: CubeModelRegistration = {
  brand: "moyu32",
  prefixes: MOYU32_NAME_PREFIXES,
  optionalServices: MOYU32_OPTIONAL_SERVICES,
  optionalManufacturerData: MOYU32_CIC_LIST,
  createDriver: () => new Moyu32CubeDriver()
};
