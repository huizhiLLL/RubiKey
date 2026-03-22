const GENERIC_MAC_STORAGE_KEY = "rubikey.cube.mac";
const LEGACY_GAN_MAC_STORAGE_KEY = "rubikey.gan.mac";

const MAC_ADDRESS_PATTERN = /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/i;

export function getRememberedMac() {
  return window.localStorage.getItem(GENERIC_MAC_STORAGE_KEY)
    ?? window.localStorage.getItem(LEGACY_GAN_MAC_STORAGE_KEY)
    ?? "";
}

export function normalizeMac(value: string | null) {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toUpperCase().replace(/-/g, ":");
  return MAC_ADDRESS_PATTERN.test(normalized) ? normalized : null;
}

export function rememberMac(value: string) {
  window.localStorage.setItem(GENERIC_MAC_STORAGE_KEY, value);
  window.localStorage.setItem(LEGACY_GAN_MAC_STORAGE_KEY, value);
}

export function saveMacInputValue(value: string) {
  const normalized = normalizeMac(value);
  if (normalized) {
    rememberMac(normalized);
    return normalized;
  }

  if (!value.trim()) {
    window.localStorage.removeItem(GENERIC_MAC_STORAGE_KEY);
    window.localStorage.removeItem(LEGACY_GAN_MAC_STORAGE_KEY);
  }
  return null;
}

export function promptForMacAddress(deviceLabel: string, suggestedMac?: string | null) {
  const remembered = suggestedMac ?? getRememberedMac();
  const value = window.prompt(
    `${deviceLabel} MAC 地址未自动获取成功。请输入设备 MAC 地址以启用协议解密。`,
    remembered || "AA:BB:CC:DD:EE:FF"
  );

  const normalized = normalizeMac(value);
  if (normalized) {
    rememberMac(normalized);
  }
  return normalized;
}

export async function readAdvertisementValue<T>(
  device: BluetoothDevice,
  extractor: (event: BluetoothAdvertisingEvent) => T | null,
  timeoutMs = 8000
) {
  if (!device.watchAdvertisements) {
    return null;
  }

  return new Promise<T | null>((resolve) => {
    const timeoutId = window.setTimeout(() => {
      cleanup();
      resolve(null);
    }, timeoutMs);

    const onAdvertisement = (event: BluetoothAdvertisingEvent) => {
      const value = extractor(event);
      if (value != null) {
        cleanup();
        resolve(value);
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
