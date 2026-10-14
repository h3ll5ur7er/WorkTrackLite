// Password-protected backups: the JSON backup text encrypted with AES-GCM under
// a key derived from the password with PBKDF2-SHA-256. Everything needed to
// decrypt (except the password) is stored next to the ciphertext, so the file
// stays self-describing. Uses WebCrypto only (no dependencies); WebCrypto needs
// a secure context (https, localhost or a file:// page).

import { BACKUP_APP_ID } from './backup';

/** OWASP's 2023 recommendation for PBKDF2-HMAC-SHA256. */
export const PBKDF2_ITERATIONS = 600_000;
/** Refuse files that would make us spin for minutes (or below anything sensible). */
const MAX_ITERATIONS = 10_000_000;
const MIN_ITERATIONS = 1_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

export interface EncryptedBackupFile {
  app: typeof BACKUP_APP_ID;
  encrypted: 1;
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; salt: string };
  cipher: { name: 'AES-GCM'; iv: string };
  /** Base64 ciphertext (with the GCM tag) of the plain backup JSON. */
  data: string;
}

export class WrongPasswordError extends Error {
  constructor() {
    super('Wrong password, or the file is damaged.');
  }
}

export function cryptoAvailable(): boolean {
  return !!globalThis.crypto?.subtle;
}

/** True for anything that looks like our encrypted envelope (even a damaged one). */
export function isEncryptedBackup(text: string): boolean {
  try {
    const o = JSON.parse(text) as Partial<EncryptedBackupFile> | null;
    return !!o && typeof o === 'object' && o.app === BACKUP_APP_ID && o.encrypted === 1;
  } catch {
    return false;
  }
}

export async function encryptBackup(plaintext: string, password: string, iterations = PBKDF2_ITERATIONS): Promise<string> {
  if (!password) throw new Error('Enter a password.');
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(password, salt, iterations);
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
  const file: EncryptedBackupFile = {
    app: BACKUP_APP_ID,
    encrypted: 1,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: toBase64(salt) },
    cipher: { name: 'AES-GCM', iv: toBase64(iv) },
    data: toBase64(new Uint8Array(data)),
  };
  return JSON.stringify(file, null, 2);
}

/** Returns the plain backup JSON. Throws `WrongPasswordError` if authentication fails. */
export async function decryptBackup(text: string, password: string): Promise<string> {
  const f = JSON.parse(text) as EncryptedBackupFile;
  const iterations = f.kdf?.iterations;
  if (
    f.kdf?.name !== 'PBKDF2' ||
    f.kdf.hash !== 'SHA-256' ||
    f.cipher?.name !== 'AES-GCM' ||
    !Number.isInteger(iterations) ||
    iterations < MIN_ITERATIONS ||
    iterations > MAX_ITERATIONS
  ) {
    throw new Error('This encrypted backup uses settings this version does not support.');
  }
  let salt: Uint8Array, iv: Uint8Array, data: Uint8Array;
  try {
    [salt, iv, data] = [fromBase64(f.kdf.salt), fromBase64(f.cipher.iv), fromBase64(f.data)];
  } catch {
    throw new WrongPasswordError();
  }
  const key = await deriveKey(password, salt, iterations);
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf(iv) }, key, buf(data));
    return new TextDecoder().decode(plain);
  } catch {
    throw new WrongPasswordError();
  }
}

async function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: buf(salt), iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** A standalone ArrayBuffer copy (WebCrypto's types reject views onto shared buffers). */
function buf(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer;
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
