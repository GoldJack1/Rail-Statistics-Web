/**
 * E2EE helpers matching iOS VaultCrypto.swift (CryptoKit AES-GCM combined box).
 * Vault key is NEVER derived from password, email, or TOTP.
 */

const VAULT_KEY_BYTES = 32
const RECOVERY_ENTROPY_BYTES = 16
const HKDF_SALT = new TextEncoder().encode('railstats.vault.recovery.v1')
const HKDF_INFO = new TextEncoder().encode('vault-wrap')
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export class VaultCryptoError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'VaultCryptoError'
  }
}

function requireCrypto(): SubtleCrypto {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new VaultCryptoError('Web Crypto is not available in this environment.')
  }
  return crypto.subtle
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
  return btoa(binary)
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

function base32Encode(bytes: Uint8Array): string {
  let output = ''
  let buffer = 0
  let bitsLeft = 0
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte
    bitsLeft += 8
    while (bitsLeft >= 5) {
      const index = (buffer >> (bitsLeft - 5)) & 0x1f
      bitsLeft -= 5
      output += BASE32_ALPHABET[index]!
    }
  }
  if (bitsLeft > 0) {
    const index = (buffer << (5 - bitsLeft)) & 0x1f
    output += BASE32_ALPHABET[index]!
  }
  let grouped = ''
  for (let i = 0; i < output.length; i++) {
    if (i > 0 && i % 4 === 0) grouped += '-'
    grouped += output[i]!
  }
  return grouped
}

export function normalizeRecoveryKeyDisplay(display: string): string {
  return display.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export function generateVaultKeyBytes(): Uint8Array {
  const key = new Uint8Array(VAULT_KEY_BYTES)
  crypto.getRandomValues(key)
  return key
}

export function generateRecoveryKeyDisplayString(): string {
  const bytes = new Uint8Array(RECOVERY_ENTROPY_BYTES)
  crypto.getRandomValues(bytes)
  return base32Encode(bytes)
}

async function importAesKey(raw: Uint8Array): Promise<CryptoKey> {
  const subtle = requireCrypto()
  const copy = new Uint8Array(raw)
  return subtle.importKey('raw', copy, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

/** CryptoKit SealedBox.combined = 12-byte nonce ‖ ciphertext ‖ 16-byte tag */
export async function encryptAesGcmCombined(plaintext: Uint8Array, keyRaw: Uint8Array): Promise<Uint8Array> {
  const subtle = requireCrypto()
  const key = await importAesKey(keyRaw)
  const nonce = new Uint8Array(12)
  crypto.getRandomValues(nonce)
  const plainCopy = new Uint8Array(plaintext)
  const sealed = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, plainCopy))
  const combined = new Uint8Array(nonce.length + sealed.length)
  combined.set(nonce, 0)
  combined.set(sealed, nonce.length)
  return combined
}

export async function decryptAesGcmCombined(combined: Uint8Array, keyRaw: Uint8Array): Promise<Uint8Array> {
  if (combined.length < 12 + 16) throw new VaultCryptoError('Could not decrypt vault data.')
  const subtle = requireCrypto()
  const key = await importAesKey(keyRaw)
  const nonce = combined.slice(0, 12)
  const ciphertextAndTag = combined.slice(12)
  try {
    return new Uint8Array(
      await subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, new Uint8Array(ciphertextAndTag))
    )
  } catch {
    throw new VaultCryptoError('Could not decrypt vault data.')
  }
}

async function wrappingKeyFromRecoveryDisplay(display: string): Promise<Uint8Array> {
  const subtle = requireCrypto()
  const normalized = normalizeRecoveryKeyDisplay(display)
  if (normalized.length < 16) throw new VaultCryptoError('Invalid recovery key.')

  const inputKey = await subtle.importKey(
    'raw',
    new TextEncoder().encode(normalized),
    'HKDF',
    false,
    ['deriveBits']
  )
  const bits = await subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(HKDF_SALT),
      info: new Uint8Array(HKDF_INFO),
    },
    inputKey,
    256
  )
  return new Uint8Array(bits)
}

export async function wrapVaultKey(
  vaultKey: Uint8Array,
  recoveryKeyDisplay: string
): Promise<Uint8Array> {
  if (vaultKey.length !== VAULT_KEY_BYTES) throw new VaultCryptoError('Invalid vault key.')
  const wrapping = await wrappingKeyFromRecoveryDisplay(recoveryKeyDisplay)
  return encryptAesGcmCombined(vaultKey, wrapping)
}

export async function unwrapVaultKey(
  wrapped: Uint8Array,
  recoveryKeyDisplay: string
): Promise<Uint8Array> {
  const wrapping = await wrappingKeyFromRecoveryDisplay(recoveryKeyDisplay)
  const raw = await decryptAesGcmCombined(wrapped, wrapping)
  if (raw.length !== VAULT_KEY_BYTES) throw new VaultCryptoError('Invalid vault key.')
  return raw
}

export const VAULT_ALG_LABEL = 'AES-GCM-256'
export const ACCOUNT_SYNC_SCHEMA_VERSION = 2
