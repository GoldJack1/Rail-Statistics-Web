import { redirect } from 'next/navigation'

/** Legacy path — keep so old links still land on D-PAYG Fares. */
export default function TicketsRedirectPage() {
  redirect('/fares/d-payg')
}
