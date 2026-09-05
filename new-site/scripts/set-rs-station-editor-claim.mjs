/**
 * Set or clear the `rs_station_editor` custom claim on a catalogue Firebase Auth user.
 *
 * Usage (from new-site/, with GOOGLE_APPLICATION_CREDENTIALS pointing at a service account):
 *   node --experimental-strip-types scripts/set-rs-station-editor-claim.mjs user@example.com
 *   node --experimental-strip-types scripts/set-rs-station-editor-claim.mjs user@example.com --revoke
 *
 * After setting, the user must refresh their ID token (sign out/in) for the claim to appear.
 */
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

async function main() {
  const email = process.argv[2]
  const revoke = process.argv.includes('--revoke')
  if (!email || email.startsWith('-')) {
    console.error('Usage: set-rs-station-editor-claim.mjs <email> [--revoke]')
    process.exit(1)
  }

  let admin
  try {
    admin = require('firebase-admin')
  } catch {
    console.error('Install firebase-admin in new-site to run this script.')
    process.exit(1)
  }

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
    })
  }

  const user = await admin.auth().getUserByEmail(email)
  const nextClaims = {
    ...(user.customClaims ?? {}),
    rs_station_editor: revoke ? undefined : true,
  }
  if (revoke) delete nextClaims.rs_station_editor
  await admin.auth().setCustomUserClaims(user.uid, nextClaims)
  console.log(
    revoke
      ? `Revoked rs_station_editor for ${email} (${user.uid})`
      : `Set rs_station_editor=true for ${email} (${user.uid})`
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
