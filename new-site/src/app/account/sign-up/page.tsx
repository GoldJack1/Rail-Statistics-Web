'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/** Temporarily closed — send visitors to sign-in. */
export default function AccountSignUpPage() {
  const router = useRouter()

  useEffect(() => {
    router.replace('/account/sign-in')
  }, [router])

  return null
}
