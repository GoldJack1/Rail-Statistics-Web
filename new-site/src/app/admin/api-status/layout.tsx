'use client'

import ProtectedRoute from '@/components/firebase/ProtectedRoute/ProtectedRoute'

/** Darwin API status: owner and Darwin preview accounts (not station-admin-only). */
export default function ApiStatusLayout({ children }: { children: React.ReactNode }) {
  return <ProtectedRoute requireDarwinTools>{children}</ProtectedRoute>
}
