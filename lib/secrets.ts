import { platformEnv } from "../db/runtime";

async function encryptionKey() {
  const source = platformEnv().CONNECTION_ENCRYPTION_KEY;
  if (!source) throw new Error("Connection encryption is not configured.");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptSecret(value: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await encryptionKey(), new TextEncoder().encode(value));
  return `${toBase64(iv)}.${toBase64(new Uint8Array(encrypted))}`;
}

export async function decryptSecret(value: string): Promise<string> {
  const [ivPart, cipherPart] = value.split(".");
  if (!ivPart || !cipherPart) throw new Error("Stored connection token is invalid.");
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(ivPart) }, await encryptionKey(), fromBase64(cipherPart));
  return new TextDecoder().decode(plain);
}

function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
