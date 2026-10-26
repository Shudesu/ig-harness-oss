'use client'
import { useEffect, useState } from 'react'
import { ApiError, clearLegacyCredentials, restoreAdminSession } from '@/lib/api'
import { useRouter, usePathname } from 'next/navigation'

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [checked, setChecked] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    clearLegacyCredentials()
    setError('')
    if (pathname === '/login') { setChecked(true); return }
    setChecked(false)
    restoreAdminSession().then(() => { if (active) setChecked(true) }).catch((error) => {
      if (!active) return
      if (error instanceof ApiError && error.status === 401) router.replace('/login')
      else setError(error instanceof Error ? error.message : 'ログイン状態を確認できません。再読み込みしてください。')
    })
    return () => { active = false }
  }, [pathname, router])

  if (error) return <div role="alert" className="p-6">{error}<a href="/login" className="ml-3 underline">ログイン画面へ</a></div>
  if (!checked) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-[3px] border-kumo-line border-t-green-500 rounded-full" />
      </div>
    )
  }

  return <>{children}</>
}
