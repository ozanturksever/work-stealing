/**
 * API key hashing utilities
 * 
 * Uses Web Crypto API (SHA-256) which works in both Node.js and browser.
 * Compatible with better-auth but does not depend on it.
 * Users can provide their own hasher if needed.
 */

/**
 * Hash an API key using SHA-256
 * 
 * @param key - The plain text API key
 * @param salt - Optional salt to add security (recommended for production)
 * @returns Hex-encoded hash string
 */
export async function hashApiKey(key: string, salt?: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(salt ? key + salt : key);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Generate a new API key with a prefix
 * 
 * @param prefix - Prefix for the key (e.g., "sk_live_", "sk_test_")
 * @returns A new random API key
 */
export function generateApiKey(prefix: string = "sk_live_"): string {
  const uuid = crypto.randomUUID().replace(/-/g, "");
  return `${prefix}${uuid}`;
}

/**
 * Extract the prefix from an API key for identification
 * 
 * @param key - The full API key
 * @param length - Length of prefix to extract (default: 12)
 * @returns The key prefix
 */
export function getApiKeyPrefix(key: string, length: number = 12): string {
  return key.substring(0, length);
}

/**
 * Verify an API key against a hash
 * 
 * @param key - The plain text API key to verify
 * @param hash - The stored hash
 * @param salt - Optional salt used during hashing
 * @returns True if the key matches the hash
 */
export async function verifyApiKey(
  key: string,
  hash: string,
  salt?: string
): Promise<boolean> {
  const keyHash = await hashApiKey(key, salt);
  return keyHash === hash;
}

/**
 * Type for custom hash function that users can provide
 */
export type HashFunction = (key: string) => Promise<string>;

/**
 * Create a hasher with a fixed salt
 */
export function createHasher(salt: string): HashFunction {
  return (key: string) => hashApiKey(key, salt);
}
