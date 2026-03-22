import type { CubeMoveEvent } from "@shared/move";
import { decodeCompressedArray, decodeEncryptedPacket, encodeEncryptedPacket, type AesDecoder } from "../core/crypto";
import { toSupportedMoveToken } from "../core/move";
import type { Moyu32DebugEntry, Moyu32ProtocolVersion } from "./protocol";
import { bytesToHex } from "./protocol";

const KEYS = [
  "NoJgjANGYJwQrADgjEUAMBmKAWCP4JNIRswt81Yp5DztE1EB2AXSA",
  "NoRg7ANAzArNAc1IigFgqgTB9MCcE8cAbBCJpKgeaSAAxTSPxgC6QA"
] as const;

function getKeyIvFromMac(mac: string) {
  const macBytes = mac.split(":").map((part) => Number.parseInt(part, 16));
  const key = decodeCompressedArray(KEYS[0]);
  const iv = decodeCompressedArray(KEYS[1]);

  for (let index = 0; index < 6; index += 1) {
    key[index] = (key[index] + macBytes[5 - index]) % 255;
    iv[index] = (iv[index] + macBytes[5 - index]) % 255;
  }

  return { key, iv };
}

function toBits(bytes: number[]) {
  return bytes.map((byte) => (byte + 256).toString(2).slice(1)).join("");
}

function parseMoveCode(code: number) {
  const face = "FBUDLR".charAt(code >> 1);
  const suffix = " '".charAt(code & 1);
  return toSupportedMoveToken(`${face}${suffix === " " ? "" : suffix}`);
}

export class Moyu32PacketParser {
  private decoder: AesDecoder | null = null;
  private previousMoveCount = -1;

  configure(mac: string | null) {
    if (!mac) {
      this.decoder = null;
      return;
    }
    this.decoder = getKeyIvFromMac(mac);
  }

  encodeRequest(payload: number[]) {
    return encodeEncryptedPacket(payload, this.decoder);
  }

  parseNotification(protocol: Moyu32ProtocolVersion, value: DataView) {
    const decodedBytes = decodeEncryptedPacket(value, this.decoder);
    const bits = toBits(decodedBytes);
    const msgType = Number.parseInt(bits.slice(0, 8), 2);
    const debug: Moyu32DebugEntry[] = [
      {
        kind: "rx",
        protocol,
        message: `Received ${protocol} packet type ${msgType} (${decodedBytes.length} bytes)`,
        hex: bytesToHex(decodedBytes),
        timestamp: Date.now()
      }
    ];

    const moves: CubeMoveEvent[] = [];

    if (msgType === 161) {
      const nameChars: string[] = [];
      for (let index = 0; index < 8; index += 1) {
        nameChars.push(String.fromCharCode(Number.parseInt(bits.slice(8 + index * 8, 16 + index * 8), 2)));
      }
      debug.push({
        kind: "info",
        protocol,
        message: `Moyu32 hardware info: ${nameChars.join("").trim() || "unknown device"}`,
        timestamp: Date.now()
      });
    }

    if (msgType === 163 && this.previousMoveCount === -1) {
      this.previousMoveCount = Number.parseInt(bits.slice(152, 160), 2);
      debug.push({
        kind: "info",
        protocol,
        message: `Initialized Moyu32 move counter at ${this.previousMoveCount}`,
        timestamp: Date.now()
      });
    }

    if (msgType === 164) {
      const batteryLevel = Number.parseInt(bits.slice(8, 16), 2);
      debug.push({
        kind: "info",
        protocol,
        message: `Battery level ${batteryLevel}%`,
        timestamp: Date.now()
      });
    }

    if (msgType === 165) {
      const moveCount = Number.parseInt(bits.slice(88, 96), 2);
      if (moveCount !== this.previousMoveCount && this.previousMoveCount !== -1) {
        const moveDiff = Math.min((moveCount - this.previousMoveCount) & 0xff, 5);
        const parsedMoves: Array<CubeMoveEvent | null> = [];

        for (let index = 0; index < 5; index += 1) {
          const rawMoveCode = Number.parseInt(bits.slice(96 + index * 5, 101 + index * 5), 2);
          const token = parseMoveCode(rawMoveCode);
          parsedMoves.push(token ? {
            move: token,
            localTimestamp: Date.now(),
            raw: {
              protocol,
              type: "moyu32-move",
              moveCount,
              rawMoveCode
            }
          } : null);
        }

        for (let index = moveDiff - 1; index >= 0; index -= 1) {
          const event = parsedMoves[index];
          if (event) {
            moves.push(event);
            debug.push({
              kind: "info",
              protocol,
              message: `Parsed move ${event.move}`,
              timestamp: Date.now()
            });
          } else {
            debug.push({
              kind: "warn",
              protocol,
              message: "Skipped unsupported or invalid Moyu32 move token",
              timestamp: Date.now()
            });
          }
        }
      }

      this.previousMoveCount = moveCount;
    }

    return { decodedBytes, debug, moves };
  }
}
