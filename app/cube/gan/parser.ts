import CryptoJS from "crypto-js";
import { decompressFromEncodedURIComponent } from "lz-string";
import type { CubeMoveEvent, MoveToken } from "../../shared/move";
import type { GanDebugEntry, GanProtocolVersion } from "./protocol";
import { bytesToHex } from "./protocol";

interface GanDecoder {
  key: number[];
  iv: number[];
}

const KEYS = [
  "NoRgnAHANATADDWJYwMxQOxiiEcfYgSK6Hpr4TYCs0IG1OEAbDszALpA",
  "NoNg7ANATFIQnARmogLBRUCs0oAYN8U5J45EQBmFADg0oJAOSlUQF0g",
  "NoRgNATGBs1gLABgQTjCeBWSUDsYBmKbCeMADjNnXxHIoIF0g",
  "NoRg7ANAzBCsAMEAsioxBEIAc0Cc0ATJkgSIYhXIjhMQGxgC6QA",
  "NoVgNAjAHGBMYDYCcdJgCwTFBkYVgAY9JpJYUsYBmAXSA",
  "NoRgNAbAHGAsAMkwgMyzClH0LFcArHnAJzIqIBMGWEAukA"
] as const;

function toWordArray(bytes: number[]) {
  const words: number[] = [];
  for (let index = 0; index < bytes.length; index += 1) {
    words[index >>> 2] |= bytes[index] << (24 - (index % 4) * 8);
  }
  return CryptoJS.lib.WordArray.create(words, bytes.length);
}

function fromWordArray(wordArray: CryptoJS.lib.WordArray) {
  const { words, sigBytes } = wordArray;
  const bytes: number[] = [];
  for (let index = 0; index < sigBytes; index += 1) {
    bytes.push((words[index >>> 2] >>> (24 - (index % 4) * 8)) & 0xff);
  }
  return bytes;
}

function aesEcbEncryptBlock(block: number[], key: number[]) {
  const encrypted = CryptoJS.AES.encrypt(toWordArray(block), toWordArray(key), {
    mode: CryptoJS.mode.ECB,
    padding: CryptoJS.pad.NoPadding
  });
  return fromWordArray(encrypted.ciphertext);
}

function aesEcbDecryptBlock(block: number[], key: number[]) {
  const decrypted = CryptoJS.AES.decrypt(
    {
      ciphertext: toWordArray(block)
    } as CryptoJS.lib.CipherParams,
    toWordArray(key),
    {
      mode: CryptoJS.mode.ECB,
      padding: CryptoJS.pad.NoPadding
    }
  );
  return fromWordArray(decrypted);
}

function decodeCompressedArray(value: string) {
  const decompressed = decompressFromEncodedURIComponent(value);
  if (!decompressed) {
    throw new Error("Failed to decode GAN key material.");
  }
  return JSON.parse(decompressed) as number[];
}

function getKeyIvFromMac(mac: string, version = 0) {
  const macBytes = mac.split(":").map((part) => Number.parseInt(part, 16));
  const key = decodeCompressedArray(KEYS[2 + version * 2]);
  const iv = decodeCompressedArray(KEYS[3 + version * 2]);

  for (let index = 0; index < 6; index += 1) {
    key[index] = (key[index] + macBytes[5 - index]) % 255;
    iv[index] = (iv[index] + macBytes[5 - index]) % 255;
  }

  return { key, iv };
}

function dataViewToBytes(value: DataView) {
  const bytes: number[] = [];
  for (let index = 0; index < value.byteLength; index += 1) {
    bytes.push(value.getUint8(index));
  }
  return bytes;
}

function moveTokenFromAxisAndPow(axis: number, pow: number): MoveToken | null {
  if (axis < 0 || axis >= 6) {
    return null;
  }
  const face = "URFDLB".charAt(axis);
  if (pow === 0) {
    return face as MoveToken;
  }
  if (pow === 1) {
    return `${face}'` as MoveToken;
  }
  if (pow === 2) {
    return `${face}2` as MoveToken;
  }
  return null;
}

export class GanPacketParser {
  private decoder: GanDecoder | null = null;
  private previousMoveCount = -1;

  configure(mac: string | null, version = 0) {
    if (!mac) {
      this.decoder = null;
      return;
    }
    this.decoder = getKeyIvFromMac(mac, version);
  }

  encodeRequest(payload: number[]) {
    if (!this.decoder) {
      return new Uint8Array(payload);
    }

    const output = payload.slice();
    const iv = this.decoder.iv;

    const encodeBlock = (block: number[]) => aesEcbEncryptBlock(block, this.decoder!.key);

    for (let index = 0; index < Math.min(16, output.length); index += 1) {
      output[index] ^= iv[index] ?? 0;
    }

    const head = encodeBlock(output.slice(0, 16));
    for (let index = 0; index < Math.min(16, output.length); index += 1) {
      output[index] = head[index];
    }

    if (output.length > 16) {
      const offset = output.length - 16;
      const tail = output.slice(offset);
      for (let index = 0; index < 16; index += 1) {
        tail[index] ^= iv[index] ?? 0;
      }
      const encodedTail = encodeBlock(tail);
      for (let index = 0; index < 16; index += 1) {
        output[offset + index] = encodedTail[index];
      }
    }

    return new Uint8Array(output);
  }

  decodeNotification(value: DataView) {
    const bytes = dataViewToBytes(value);
    if (!this.decoder) {
      return bytes;
    }

    const decoded = bytes.slice();
    const iv = this.decoder.iv;

    if (decoded.length > 16) {
      const offset = decoded.length - 16;
      const tail = aesEcbDecryptBlock(decoded.slice(offset), this.decoder.key);
      for (let index = 0; index < 16; index += 1) {
        decoded[offset + index] = tail[index] ^ (iv[index] ?? 0);
      }
    }

    const headLength = Math.min(16, decoded.length);
    const headSource = decoded.slice(0, 16);
    const head = aesEcbDecryptBlock(headSource, this.decoder.key);
    for (let index = 0; index < headLength; index += 1) {
      decoded[index] = head[index] ^ (iv[index] ?? 0);
    }

    return decoded;
  }

  parseNotification(protocol: GanProtocolVersion, value: DataView) {
    const decodedBytes = this.decodeNotification(value);
    const debug: GanDebugEntry[] = [
      {
        kind: "rx",
        protocol,
        message: `Received ${protocol} packet (${decodedBytes.length} bytes)` ,
        hex: bytesToHex(decodedBytes),
        timestamp: Date.now()
      }
    ];

    const moves: CubeMoveEvent[] = [];

    if (protocol === "v3") {
      const parsedMove = this.parseV3Move(decodedBytes);
      if (parsedMove) {
        moves.push(parsedMove);
        debug.push({
          kind: "info",
          protocol,
          message: `Parsed move ${parsedMove.move}`,
          timestamp: Date.now()
        });
      }
    }

    if (protocol === "v4") {
      const parsedMove = this.parseV4Move(decodedBytes);
      if (parsedMove) {
        moves.push(parsedMove);
        debug.push({
          kind: "info",
          protocol,
          message: `Parsed move ${parsedMove.move}`,
          timestamp: Date.now()
        });
      }
    }

    if (protocol === "v2") {
      const parsedMove = this.parseV2Move(decodedBytes);
      if (parsedMove) {
        moves.push(parsedMove);
        debug.push({
          kind: "info",
          protocol,
          message: `Parsed move ${parsedMove.move}`,
          timestamp: Date.now()
        });
      }
    }

    return { decodedBytes, debug, moves };
  }

  private parseV2Move(bytes: number[]) {
    const bits = bytes.map((byte) => (byte + 256).toString(2).slice(1)).join("");
    const mode = Number.parseInt(bits.slice(0, 4), 2);
    if (mode !== 2) {
      return null;
    }

    const moveCount = Number.parseInt(bits.slice(4, 12), 2);
    if (moveCount === this.previousMoveCount || this.previousMoveCount === -1) {
      this.previousMoveCount = moveCount;
      return null;
    }

    const rawMove = Number.parseInt(bits.slice(12, 17), 2);
    const token = moveTokenFromAxisAndPow(rawMove >> 1, rawMove & 1);
    this.previousMoveCount = moveCount;
    if (!token) {
      return null;
    }

    return {
      move: token,
      localTimestamp: Date.now()
    } satisfies CubeMoveEvent;
  }

  private parseV3Move(bytes: number[]) {
    const bits = bytes.map((byte) => (byte + 256).toString(2).slice(1)).join("");
    const magic = Number.parseInt(bits.slice(0, 8), 2);
    const mode = Number.parseInt(bits.slice(8, 16), 2);
    const length = Number.parseInt(bits.slice(16, 24), 2);
    if (magic !== 0x55 || length <= 0 || mode !== 1) {
      return null;
    }

    const moveCount = Number.parseInt(bits.slice(64, 72) + bits.slice(56, 64), 2);
    if (moveCount === this.previousMoveCount || this.previousMoveCount === -1) {
      this.previousMoveCount = moveCount;
      return null;
    }

    const deviceTimestamp = Number.parseInt(
      bits.slice(48, 56) + bits.slice(40, 48) + bits.slice(32, 40) + bits.slice(24, 32),
      2
    );
    const pow = Number.parseInt(bits.slice(72, 74), 2);
    const axisMask = Number.parseInt(bits.slice(74, 80), 2);
    const axis = [2, 32, 8, 1, 16, 4].indexOf(axisMask);
    const token = moveTokenFromAxisAndPow(axis, pow);
    this.previousMoveCount = moveCount;

    if (!token) {
      return null;
    }

    return {
      move: token,
      deviceTimestamp,
      localTimestamp: Date.now()
    } satisfies CubeMoveEvent;
  }

  private parseV4Move(bytes: number[]) {
    const bits = bytes.map((byte) => (byte + 256).toString(2).slice(1)).join("");
    const mode = Number.parseInt(bits.slice(0, 8), 2);
    if (mode !== 0x01) {
      return null;
    }

    const moveCount = Number.parseInt(bits.slice(56, 64) + bits.slice(48, 56), 2);
    if (moveCount === this.previousMoveCount || this.previousMoveCount === -1) {
      this.previousMoveCount = moveCount;
      return null;
    }

    const deviceTimestamp = Number.parseInt(
      bits.slice(40, 48) + bits.slice(32, 40) + bits.slice(24, 32) + bits.slice(16, 24),
      2
    );
    const pow = Number.parseInt(bits.slice(64, 66), 2);
    const axisMask = Number.parseInt(bits.slice(66, 72), 2);
    const axis = [2, 32, 8, 1, 16, 4].indexOf(axisMask);
    const token = moveTokenFromAxisAndPow(axis, pow);
    this.previousMoveCount = moveCount;

    if (!token) {
      return null;
    }

    return {
      move: token,
      deviceTimestamp,
      localTimestamp: Date.now()
    } satisfies CubeMoveEvent;
  }
}
