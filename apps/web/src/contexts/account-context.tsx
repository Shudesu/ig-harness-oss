'use client'

import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import type { ReactNode } from 'react'

// Instagram Harness has a single account (IG Business Account),
// so this context is a simplified stub for compatibility.

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

const STUB_ACCOUNT: AccountWithStats = {
  id: 'default',
  name: 'Instagram Account',
  displayName: 'Instagram Account',
  isActive: true,
}

export function AccountProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(false)

  const refreshAccounts = useCallback(async () => {
    setLoading(false)
  }, [])

  useEffect(() => {
    refreshAccounts()
  }, [refreshAccounts])

  return (
    <AccountContext.Provider
      value={{
        accounts: [STUB_ACCOUNT],
        selectedAccountId: STUB_ACCOUNT.id,
        selectedAccount: STUB_ACCOUNT,
        setSelectedAccountId: () => {},
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
