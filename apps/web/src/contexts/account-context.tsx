'use client'

import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react'
import type { ReactNode } from 'react'
import { accountsApi, setApiAccountId, ApiError, type IgAccountSummary } from '@/lib/api'

const STORAGE_KEY = 'ih_account_id'

export interface AccountWithStats {
  id: string
  name: string
  displayName?: string
  pictureUrl?: string
  isActive: boolean
}

interface AccountContextValue {
  accounts: AccountWithStats[]
  selectedAccountId: string | null
  selectedAccount: AccountWithStats | null
  setSelectedAccountId: (id: string) => void
  refreshAccounts: () => Promise<void>
  loading: boolean
}

const AccountContext = createContext<AccountContextValue | null>(null)

function toAccountWithStats(row: IgAccountSummary): AccountWithStats {
  const name = row.username ? `@${row.username}` : row.igUserId
  return {
    id: row.id,
    name,
    displayName: name,
    isActive: row.isActive,
  }
}

function readStoredId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

function storeId(id: string) {
  try {
    localStorage.setItem(STORAGE_KEY, id)
  } catch {
    // localStorage unavailable (private mode etc.) — selection just won't persist
  }
}

export function AccountProvider({ children }: { children: ReactNode }) {
  const [accounts, setAccounts] = useState<AccountWithStats[]>([])
  const [selectedAccountId, setSelectedIdState] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null
    // Hydrate the api layer synchronously from localStorage so child pages'
    // very first mount fetches are already scoped to the stored account —
    // without this, a fresh load with a secondary account selected flashes
    // (and keeps) default-account data until the account list arrives.
    const stored = readStoredId()
    setApiAccountId(stored)
    return stored
  })
  const [loading, setLoading] = useState(true)

  const refreshAccounts = useCallback(async () => {
    setLoading(true)
    try {
      const rows = await accountsApi.list()

      // Resolve selection: stored id if it still exists, else default, else first.
      const stored = readStoredId()
      const resolved =
        (stored && rows.some((r) => r.id === stored) ? stored : null) ??
        rows.find((r) => r.isDefault)?.id ??
        rows[0]?.id ??
        null

      // Inject into the api layer BEFORE updating state so every fetch
      // triggered by the re-render is already scoped to the right account.
      setApiAccountId(resolved)
      if (resolved) storeId(resolved)
      setAccounts(rows.map(toAccountWithStats))
      setSelectedIdState(resolved)
    } catch (err) {
      // Unauthenticated (401) or unreachable API: fall back to the empty
      // stub-equivalent state instead of crashing — AuthGuard redirects to
      // /login, and the provider remounts (and refetches) after login.
      setApiAccountId(null)
      setAccounts([])
      setSelectedIdState(null)
      if (!(err instanceof ApiError && (err.status === 401 || err.status === 403))) {
        console.error('Failed to load IG accounts:', err)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refreshAccounts()
  }, [refreshAccounts])

  const setSelectedAccountId = useCallback((id: string) => {
    // Always inject into the api layer first so subsequent fetches use it.
    setApiAccountId(id)
    storeId(id)
    setSelectedIdState(id)
  }, [])

  const selectedAccount = useMemo(
    () => accounts.find((a) => a.id === selectedAccountId) ?? null,
    [accounts, selectedAccountId],
  )

  return (
    <AccountContext.Provider
      value={{
        accounts,
        selectedAccountId,
        selectedAccount,
        setSelectedAccountId,
        refreshAccounts,
        loading,
      }}
    >
      {children}
    </AccountContext.Provider>
  )
}

export function useAccount(): AccountContextValue {
  const ctx = useContext(AccountContext)
  if (!ctx) throw new Error('useAccount must be used within AccountProvider')
  return ctx
}
