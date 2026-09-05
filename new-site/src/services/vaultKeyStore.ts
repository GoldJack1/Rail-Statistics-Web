/**
 * In-memory + sessionStorage vault key (tab session).
 * Optional localStorage per uid = “remember this device” (Keychain analogue).
 */
const SESSION_KEY = 'rs-uas-vault-key-v1'
const REMEMBER_PREFIX = 'rs-uas-vault-key-remember-v1:'

let memoryKey: Uint8Array | null = null
/** uid whose key is currently in memory/session (for forget / restore). */
let activeUid: string | null = null

function bytesToB64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
  return btoa(binary)
}

function b64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

function rememberStorageKey(uid: string): string {
  return `${REMEMBER_PREFIX}${uid}`
}

function readSessionRaw(): string | null {
  if (typeof sessionStorage === 'undefined') return null
  try {
    return sessionStorage.getItem(SESSION_KEY)
  } catch {
    return null
  }
}

function writeSessionRaw(raw: string | null): void {
  if (typeof sessionStorage === 'undefined') return
  try {
    if (raw) sessionStorage.setItem(SESSION_KEY, raw)
    else sessionStorage.removeItem(SESSION_KEY)
  } catch {
    /* ignore quota / private mode */
  }
}

function readRememberedRaw(uid: string): string | null {
  if (typeof localStorage === 'undefined') return null
  try {
    return localStorage.getItem(rememberStorageKey(uid))
  } catch {
    return null
  }
}

function writeRememberedRaw(uid: string, raw: string | null): void {
  if (typeof localStorage === 'undefined') return
  try {
    if (raw) localStorage.setItem(rememberStorageKey(uid), raw)
    else localStorage.removeItem(rememberStorageKey(uid))
  } catch {
    /* ignore */
  }
}

export function isVaultUnlocked(): boolean {
  if (memoryKey) return true
  return Boolean(readSessionRaw())
}

export function hasRememberedVaultKey(uid: string): boolean {
  return Boolean(readRememberedRaw(uid))
}

/**
 * Load remembered key for this uid into memory/session if present.
 * Returns true when the vault is unlocked afterwards.
 */
export function restoreRememberedVaultKey(uid: string): boolean {
  const remembered = readRememberedRaw(uid)
  if (!remembered) {
    // Session may still hold a key from this tab without remember.
    if (isVaultUnlocked()) {
      activeUid = uid
      return true
    }
    return false
  }
  try {
    memoryKey = b64ToBytes(remembered)
    activeUid = uid
    writeSessionRaw(remembered)
    return true
  } catch {
    writeRememberedRaw(uid, null)
    return false
  }
}

export function getUnlockedVaultKey(): Uint8Array | null {
  if (memoryKey) return memoryKey
  const raw = readSessionRaw()
  if (!raw) return null
  try {
    memoryKey = b64ToBytes(raw)
    return memoryKey
  } catch {
    return null
  }
}

export function requireUnlockedVaultKey(): Uint8Array {
  const key = getUnlockedVaultKey()
  if (!key) throw new Error('Cloud sync is locked. Enter your recovery key first.')
  return key
}

export type SetVaultKeyOptions = {
  uid: string
  /** Persist across browser sessions on this device. Default false. */
  rememberDevice?: boolean
}

export function setUnlockedVaultKey(key: Uint8Array, options?: SetVaultKeyOptions): void {
  memoryKey = key
  const raw = bytesToB64(key)
  writeSessionRaw(raw)
  if (options?.uid) {
    activeUid = options.uid
    if (options.rememberDevice) {
      writeRememberedRaw(options.uid, raw)
    } else {
      // Explicit unlock without remember clears a prior remember for this account.
      writeRememberedRaw(options.uid, null)
    }
  }
}

/** Clears tab session key only — keeps localStorage “remember this device”. */
export function lockVaultKey(): void {
  memoryKey = null
  activeUid = null
  writeSessionRaw(null)
}

/** Removes remembered key for uid (and session if it matches). */
export function forgetRememberedVaultKey(uid: string): void {
  writeRememberedRaw(uid, null)
  if (activeUid === uid || !activeUid) {
    memoryKey = null
    activeUid = null
    writeSessionRaw(null)
  }
}
