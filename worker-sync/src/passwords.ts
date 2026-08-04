import { RequestError } from "./validation";

export const PASSWORD_ALGORITHM = "PBKDF2-SHA512" as const;
// Cloudflare Workers Web Crypto currently caps PBKDF2 at 100,000 iterations.
// Keep this centralized so credentials can be upgraded when the runtime ceiling changes.
export const PASSWORD_ITERATIONS = 100_000;
const PASSWORD_MIN_LENGTH = 12;
const PASSWORD_MAX_LENGTH = 128;

export type PasswordCredential = {
  algorithm: typeof PASSWORD_ALGORITHM;
  iterations: number;
  salt: string;
  passwordHash: string;
};

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> | null {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(new ArrayBuffer(binary.length));
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}

function timingSafeBytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  let mismatch = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    mismatch |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return mismatch === 0;
}

async function derivePassword(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-512",
      salt,
      iterations,
    },
    key,
    512,
  );
  return new Uint8Array(bits);
}

export function parsePassword(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length < PASSWORD_MIN_LENGTH ||
    value.length > PASSWORD_MAX_LENGTH
  ) {
    throw new RequestError(400, "invalid_password");
  }
  return value;
}

export function normalizeEmail(value: unknown): { email: string; normalizedEmail: string } {
  if (typeof value !== "string") throw new RequestError(400, "invalid_email");
  const email = value.trim().normalize("NFKC");
  const normalizedEmail = email.toLocaleLowerCase("en-US");
  if (
    !email ||
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    throw new RequestError(400, "invalid_email");
  }
  return { email, normalizedEmail };
}

export async function hashPassword(password: string): Promise<PasswordCredential> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return {
    algorithm: PASSWORD_ALGORITHM,
    iterations: PASSWORD_ITERATIONS,
    salt: bytesToBase64(salt),
    passwordHash: bytesToBase64(
      await derivePassword(password, salt, PASSWORD_ITERATIONS),
    ),
  };
}

export async function verifyPassword(
  password: string,
  credential: PasswordCredential,
): Promise<boolean> {
  if (
    credential.algorithm !== PASSWORD_ALGORITHM ||
    !Number.isInteger(credential.iterations) ||
    credential.iterations < 100_000 ||
    credential.iterations > 1_000_000
  ) {
    return false;
  }
  const salt = base64ToBytes(credential.salt);
  const expected = base64ToBytes(credential.passwordHash);
  if (!salt || !expected || salt.length < 16 || expected.length !== 64) return false;
  const actual = await derivePassword(password, salt, credential.iterations);
  // The deployed compatibility date predates subtle.timingSafeEqual in the
  // generated runtime types, so compare the fixed 64-byte derived keys with a
  // full XOR pass instead of a short-circuiting string comparison.
  return timingSafeBytesEqual(actual, expected);
}

export function createSessionToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `kbs_${bytesToBase64(bytes)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/g, "")}`;
}
