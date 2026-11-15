'use client'
import { usePathname } from 'next/navigation'
import Sidebar from './layout/sidebar'
import { AuthProvider, useAuthStatus } from '@/contexts/auth-context'
import { AccountProvider } from '@/contexts/account-context'

// 認証チェック中もシェル（サイドバー）を保持し、コンテンツ領域だけを
// 部分スケルトンへ差し替える。旧実装は全画面スピナーでレイアウトごと消していた。
function ContentGate({ children }: { children: React.ReactNode }) {
  const status = useAuthStatus()
  if (status === 'ok') return <>{children}</>
  if (status === 'error') return null // AuthProvider がバナーを表示する
  return (
    <div className="animate-pulse space-y-4 max-w-2xl" aria-hidden="true">
      <div className="h-8 w-1/3 rounded bg-kumo-line/70" />
      <div className="h-28 rounded-xl bg-kumo-line/50" />
      <div className="h-28 rounded-xl bg-kumo-line/50" />
      <div className="h-28 rounded-xl bg-kumo-line/50" />
    </div>
  )
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  // trailingSlash: true in next.config makes usePathname return '/login/'
  if (pathname === '/login' || pathname === '/login/') {
    return <>{children}</>
  }

  return (
    <AuthProvider>
      <AccountProvider>
        <div className="flex min-h-screen">
          <Sidebar />
          <main className="flex-1 pt-[72px] px-4 pb-6 sm:px-6 lg:pt-8 lg:px-8 lg:pb-8 overflow-auto">
            <ContentGate>{children}</ContentGate>
          </main>
        </div>
      </AccountProvider>
    </AuthProvider>
  )
}
