'use client'
import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    if (pathname === '/login') {
      setChecked(true)
      return
    }

    for (const key of ['lh_api_key', 'lh_staff_name', 'lh_staff_role']) localStorage.removeItem(key)
    const key = sessionStorage.getItem('igh_api_key')
    if (!key) {
      router.replace('/login')
    } else {
      setChecked(true)
    }
  }, [pathname, router])

  if (!checked) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-[3px] border-kumo-line border-t-green-500 rounded-full" />
      </div>
    )
  }

  return <>{children}</>
}
