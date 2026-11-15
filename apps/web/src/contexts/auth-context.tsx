'use client'

// 認証状態を「枠の外」で管理する。
// 旧AuthGuardはチェック中にレイアウトごと全画面スピナーへ差し替えていたため、
// リロードのたびに画面全体が再マウントして見えた。
// - チェック中もシェル（サイドバー等）はそのまま残す
// - 前回セッションの証跡（sessionStorage）があれば楽観的にシェルを出し、
//   裏で /api/auth/session を検証する（stale-while-revalidate）
// - 401 のときだけ /login へ誘導。それ以外のエラーはシェルを消さずバナーで通知
import { createContext, useContext, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ApiError, clearLegacyCredentials, restoreAdminSession } from '@/lib/api'

export type AuthStatus = 'checking' | 'ok' | 'error'

const AuthContext = createContext<AuthStatus>('checking')

export function useAuthStatus(): AuthStatus {
  return useContext(AuthContext)
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [status, setStatus] = useState<AuthStatus>('checking')
  const [error, setError] = useState('')

  // ページ遷移では再チェックしない（マウント時の1回だけ）。旧実装は pathname
  // 依存で遷移のたびに checked=false へ戻し、全画面スピナーを点滅させていた。
  useEffect(() => {
    let active = true
    clearLegacyCredentials()
    try {
      if (sessionStorage.getItem('igh_staff_name')) setStatus('ok')
    } catch {
      // sessionStorage 不使用の環境では通常どおりチェックを待つ
    }
    restoreAdminSession()
      .then(() => {
        if (active) setStatus('ok')
      })
      .catch((err) => {
        if (!active) return
        if (err instanceof ApiError && err.status === 401) {
          router.replace('/login')
          return
        }
        // 401以外（ネットワーク断など）はシェルを消さず、内容側に通知を出す
        setError(
          err instanceof Error
            ? err.message
            : 'ログイン状態を確認できません。再読み込みしてください。',
        )
        setStatus('error')
      })
    return () => {
      active = false
    }
  }, [router])

  return (
    <AuthContext.Provider value={status}>
      {children}
      {status === 'error' && (
        <div
          role="alert"
          className="fixed inset-x-0 top-0 z-50 bg-red-50 border-b border-red-200 text-red-800 px-4 py-2 text-sm"
        >
          {error}
          <a href="/login" className="ml-3 underline">
            ログイン画面へ
          </a>
        </div>
      )}
    </AuthContext.Provider>
  )
}
