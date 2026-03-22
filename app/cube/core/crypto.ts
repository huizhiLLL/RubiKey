import CryptoJS from "crypto-js";
import { decompressFromEncodedURIComponent } from "lz-string";

export interface AesDecoder {
  key: number[];
  iv: number[];
}

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

export function decodeCompressedArray(value: string) {
  const decompressed = decompressFromEncodedURIComponent(value);
  if (!decompressed) {
    throw new Error("Failed to decode cube key material.");
  }
  return JSON.parse(decompressed) as number[];
}

export function dataViewToBytes(value: DataView) {
  const bytes: number[] = [];
  for (let index = 0; index < value.byteLength; index += 1) {
    bytes.push(value.getUint8(index));
  }
  return bytes;
}

export function encodeEncryptedPacket(payload: number[], decoder: AesDecoder | null) {
  if (!decoder) {
    return new Uint8Array(payload);
  }

  const output = payload.slice();
  const { iv, key } = decoder;

  for (let index = 0; index < Math.min(16, output.length); index += 1) {
    output[index] ^= iv[index] ?? 0;
  }

  const head = aesEcbEncryptBlock(output.slice(0, 16), key);
  for (let index = 0; index < Math.min(16, output.length); index += 1) {
    output[index] = head[index];
  }

  if (output.length > 16) {
    const offset = output.length - 16;
    const tail = output.slice(offset);
    for (let index = 0; index < 16; index += 1) {
      tail[index] ^= iv[index] ?? 0;
    }
    const encodedTail = aesEcbEncryptBlock(tail, key);
    for (let index = 0; index < 16; index += 1) {
      output[offset + index] = encodedTail[index];
    }
  }

  return new Uint8Array(output);
}

export function decodeEncryptedPacket(value: DataView, decoder: AesDecoder | null) {
  const bytes = dataViewToBytes(value);
  if (!decoder) {
    return bytes;
  }

  const decoded = bytes.slice();
  const { iv, key } = decoder;

  if (decoded.length > 16) {
    const offset = decoded.length - 16;
    const tail = aesEcbDecryptBlock(decoded.slice(offset), key);
    for (let index = 0; index < 16; index += 1) {
      decoded[offset + index] = tail[index] ^ (iv[index] ?? 0);
    }
  }

  const headLength = Math.min(16, decoded.length);
  const head = aesEcbDecryptBlock(decoded.slice(0, 16), key);
  for (let index = 0; index < headLength; index += 1) {
    decoded[index] = head[index] ^ (iv[index] ?? 0);
  }

  return decoded;
}
