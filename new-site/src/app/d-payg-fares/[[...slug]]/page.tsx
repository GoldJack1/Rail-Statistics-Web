import TicketsPageClient from '../TicketsPageClient'

/**
 * D-PAYG fare lookup — one optional catch-all so `/area` → `/area/od` soft-navigates
 * without remounting the client (which was wiping search state).
 *
 * Examples:
 * - `/d-payg-fares`
 * - `/d-payg-fares/sheffield-doncaster`
 * - `/d-payg-fares/sheffield-doncaster/shf-mhs`
 */
export default function DpaygFaresSlugPage() {
  return <TicketsPageClient />
}
