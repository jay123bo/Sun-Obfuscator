/**
 * Runtime string obfuscation helpers.
 * UTF-8 safe and suitable for the unified obfuscation pipeline.
 */

export type EncryptionAlgorithm = "none" | "xor" | "base64" | "huffman" | "chunked";

export interface EncryptedString {
  algorithm: EncryptionAlgorithm;
  data: string | number[] | string[];
  key?: number | string;
  decryptorFunction?: string;
}

function utf8Bytes(input: string): number[] {
  if (typeof TextEncoder !== "undefined") return Array.from(new TextEncoder().encode(input));
  const encoded = unescape(encodeURIComponent(input));
  const bytes: number[] = [];
  for (let i = 0; i < encoded.length; i++) bytes.push(encoded.charCodeAt(i));
  return bytes;
}

function escapeLuaString(input: string): string {
  return input.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r/g, "\\r").replace(/\n/g, "\\n");
}

export function encryptXOR(input: string): EncryptedString {
  const key = Math.floor(Math.random() * 254) + 1;
  const bytes = utf8Bytes(input).map((byte, index) => byte ^ (((key + index) % 255) + 1));
  const decryptorFunction =
    '(function(t,k)local s=""for i=1,#t do s=s..string.char(t[i]~(((k+i-1)%255)+1))end return s end)';
  return { algorithm: "xor", data: bytes, key, decryptorFunction };
}

export function encryptBase64(input: string): EncryptedString {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const bytes = utf8Bytes(input);
  let encoded = "";

  for (let i = 0; i < bytes.length; i += 3) {
    const b1 = bytes[i] || 0;
    const b2 = bytes[i + 1] || 0;
    const b3 = bytes[i + 2] || 0;
    const e1 = Math.floor(b1 / 4);
    const e2 = (b1 % 4) * 16 + Math.floor(b2 / 16);
    const e3 = (b2 % 16) * 4 + Math.floor(b3 / 64);
    const e4 = b3 % 64;
    encoded += alphabet[e1] + alphabet[e2];
    encoded += i + 1 < bytes.length ? alphabet[e3] : "=";
    encoded += i + 2 < bytes.length ? alphabet[e4] : "=";
  }

  const decryptorFunction =
    '(function(s)local a="' + alphabet + '"local d=""local function f(c)for i=1,#a do if a:sub(i,i)==c then return i-1 end end return 0 end for i=1,#s,4 do local b1,b2,b3,b4=f(s:sub(i,i)),f(s:sub(i+1,i+1)),f(s:sub(i+2,i+2)),f(s:sub(i+3,i+3))local c1=b1*4+math.floor(b2/16)local c2=(b2%16)*16+math.floor(b3/4)local c3=(b3%4)*64+b4 d=d..string.char(c1)if s:sub(i+2,i+2)~="="then d=d..string.char(c2)end if s:sub(i+3,i+3)~="="then d=d..string.char(c3)end end return d end)';

  return { algorithm: "base64", data: encoded, key: "standard", decryptorFunction };
}

export function encryptHuffman(input: string): EncryptedString {
  const bytes = utf8Bytes(input);
  const freq = new Map<number, number>();
  for (const byte of bytes) freq.set(byte, (freq.get(byte) || 0) + 1);

  const sorted = Array.from(freq.entries()).sort((a, b) => b[1] - a[1]);
  const byteToCode = new Map<number, number>();
  sorted.forEach(([byte], index) => byteToCode.set(byte, index));

  const codes = bytes.map(byte => byteToCode.get(byte) || 0);
  const dictionary = Array.from(byteToCode.entries())
    .sort((a, b) => a[1] - b[1])
    .map(([byte]) => byte);

  const dictStr = "{" + dictionary.join(",") + "}";
  const codesStr = "{" + codes.join(",") + "}";
  const decryptorFunction =
    "(function(c,d)local s=\"\"for i=1,#c do s=s..string.char(d[c[i]+1])end return s end)(" +
    codesStr + "," + dictStr + ")";

  return { algorithm: "huffman", data: codes, key: dictionary.join(","), decryptorFunction };
}

export function encryptChunked(input: string): EncryptedString {
  const chunkSize = Math.floor(Math.random() * 5) + 3;
  const bytes = utf8Bytes(input);
  const chunks: string[] = [];

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.slice(i, i + chunkSize);
    chunks.push("string.char(" + chunk.join(",") + ")");
  }

  return {
    algorithm: "chunked",
    data: chunks,
    key: chunkSize,
    decryptorFunction: chunks.join(".."),
  };
}

export function encryptString(input: string, algorithm: EncryptionAlgorithm = "xor"): EncryptedString {
  if (algorithm === "none" || input.length === 0) {
    return {
      algorithm: "none",
      data: input,
      decryptorFunction: '"' + escapeLuaString(input) + '"',
    };
  }

  switch (algorithm) {
    case "xor":
      return encryptXOR(input);
    case "base64":
      return encryptBase64(input);
    case "huffman":
      return encryptHuffman(input);
    case "chunked":
      return encryptChunked(input);
    default:
      return encryptXOR(input);
  }
}

export function generateDecryptorCode(encrypted: EncryptedString): string {
  if (!encrypted.decryptorFunction) {
    if (typeof encrypted.data === "string") {
      return '"' + escapeLuaString(encrypted.data) + '"';
    }
    return "string.char(" + encrypted.data.join(",") + ")";
  }
  return encrypted.decryptorFunction;
}
