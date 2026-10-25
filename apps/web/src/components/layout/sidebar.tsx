'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { Button } from '@cloudflare/kumo/components/button'
import { BrandMark } from '@/components/brand'
import { usePathname } from 'next/navigation'
import { useAccount } from '@/contexts/account-context'
import type { AccountWithStats } from '@/contexts/account-context'

// ─── Instagram Harness navigation (4 pages only) ───

const menuItems = [
  {
    href: '/',
    label: 'ダッシュボード',
    icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6',
  },
  {
    href: '/followers',
    label: 'フォロワー',
    icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z',
  },
  // コメントルール / シナリオは キャンペーン に統合したのでサイドバーから外す。
  // /comment-rules と /scenarios は直接URLで残存ルール管理用にアクセス可能。
  {
    href: '/chats',
    label: 'チャット',
    icon: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z',
  },
  {
    href: '/campaigns',
    label: 'キャンペーン',
    icon: 'M13 10V3L4 14h7v7l9-11h-7z',
  },
  {
    href: '/posts',
    label: '投稿',
    icon: 'M12 4v16m8-8H4',
  },
  {
    href: '/rich-messages',
    label: 'DMテンプレート',
    icon: 'M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z',
  },
  {
    href: '/images',
    label: '画像ギャラリー',
    icon: 'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z',
  },
  {
    href: '/settings',
    label: '設定',
    icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065zM15 12a3 3 0 11-6 0 3 3 0 016 0z',
  },
]

// Instagram gradient color
const IG_COLOR = '#E1306C'
const IG_GRADIENT = 'linear-gradient(135deg, #f09433, #e6683c, #dc2743, #cc2366, #bc1888)'

function NavIcon({ d }: { d: string }) {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={d} />
    </svg>
  )
}

function AccountAvatar({ account, size = 28 }: { account: AccountWithStats; size?: number }) {
  const displayName = account.displayName || account.name
  if (account.pictureUrl) {
    return (
      <img
        src={account.pictureUrl}
        alt={displayName}
        className="rounded-full object-cover shrink-0"
        style={{ width: size, height: size }}
      />
    )
  }
  // No profile picture: brand-gradient circle with the account initial
  // (skip the leading @ so "@ig_harness" shows "I", not "@").
  const initial = displayName.replace(/^@/, '').charAt(0).toUpperCase() || '?'
  return (
    <div
      className="rounded-full flex items-center justify-center text-white font-bold shrink-0"
      style={{ width: size, height: size, background: IG_GRADIENT, fontSize: size * 0.4 }}
    >
      {initial}
    </div>
  )
}

// Mirrors the LINE Harness OSS sidebar AccountSwitcher: always-visible
// current-account row that expands into a dropdown listing every account.
function AccountSwitcher() {
  const { accounts, selectedAccount, selectedAccountId, setSelectedAccountId, loading } = useAccount()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  if (loading || accounts.length === 0) return null

  const displayName = selectedAccount?.displayName || selectedAccount?.name || ''

  return (
    <div ref={ref} className="mt-3">
      <Button
        onClick={() => setOpen(!open)}
        aria-label="アカウント切替"
        className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg bg-kumo-canvas border border-kumo-line hover:bg-kumo-tint transition-colors"
      >
        {selectedAccount && <AccountAvatar account={selectedAccount} size={28} />}
        <div className="flex-1 text-left min-w-0">
          <p className="text-sm font-medium text-kumo-default truncate">{displayName}</p>
          {selectedAccount && !selectedAccount.isActive && (
            <p className="text-[10px] text-kumo-subtle">停止中</p>
          )}
        </div>
        <svg
          className={`w-4 h-4 text-kumo-subtle shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </Button>

      {open && (
        <div className="mt-1 bg-kumo-base border border-kumo-line rounded-lg shadow-lg overflow-hidden">
          {accounts.map((account) => {
            const isSelected = account.id === selectedAccountId
            const name = account.displayName || account.name
            return (
              <Button
                key={account.id}
                onClick={() => {
                  setOpen(false)
                  if (account.id === selectedAccountId) return
                  setSelectedAccountId(account.id)
                  // Land on the dashboard instead of reloading in place: detail
                  // URLs like /campaigns/[id] belong to the previous account and
                  // would render (or let you edit) cross-account data.
                  window.location.href = '/'
                }}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors ${
                  isSelected ? 'bg-pink-50' : 'hover:bg-kumo-canvas'
                }`}
              >
                <AccountAvatar account={account} size={24} />
                <div className="flex-1 min-w-0">
                  <p className={`text-sm truncate ${isSelected ? 'font-semibold text-[#E1306C]' : 'text-kumo-default'}`}>
                    {name}
                  </p>
                  {!account.isActive && (
                    <p className="text-xs text-kumo-subtle truncate">停止中</p>
                  )}
                </div>
                {isSelected && (
                  <svg className="w-4 h-4 shrink-0" style={{ color: IG_COLOR }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </Button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default function Sidebar() {
  const pathname = usePathname()
  const [isOpen, setIsOpen] = useState(false)
  const [staffName, setStaffName] = useState<string | null>(null)

  useEffect(() => {
    setStaffName(sessionStorage.getItem('igh_staff_name'))
  }, [])

  useEffect(() => { setIsOpen(false) }, [pathname])
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setIsOpen(false) }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [])
  useEffect(() => {
    document.body.style.overflow = isOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [isOpen])

  const isActive = (href: string) => href === '/' ? pathname === '/' : pathname.startsWith(href)

  const sidebarContent = (
    <>
      {/* Logo */}
      <div className="px-6 py-5 border-b border-kumo-line">
        <div className="flex items-center gap-2">
          <BrandMark size={32} />
          <div>
            <p className="text-sm font-bold text-kumo-default leading-tight">IG Harness</p>
            <p className="text-xs text-kumo-subtle">管理画面</p>
          </div>
        </div>

        {/* Account switcher — always visible so the active account is obvious */}
        <AccountSwitcher />
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {menuItems.map((item) => {
          const active = isActive(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                active
                  ? 'bg-kumo-tint text-kumo-default'
                  : 'text-kumo-subtle hover:bg-kumo-tint hover:text-kumo-default'
              }`}
              aria-current={active ? 'page' : undefined}
            >
              <NavIcon d={item.icon} />
              {item.label}
            </Link>
          )
        })}
      </nav>

      {/* Footer */}
      <div className="border-t border-kumo-line">
        {staffName && (
          <div className="px-3 py-2 text-xs text-kumo-subtle border-t border-kumo-line">
            <div className="font-medium text-kumo-default">{staffName}</div>
          </div>
        )}
        <div className="px-6 py-4 space-y-3">
          <p className="text-xs text-kumo-subtle">IG Harness v{process.env.APP_VERSION || '0.0.0'}</p>
          <a
            href="https://harness-wiki.pages.dev/article/ig-harness-complete-setup-guide"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-xs text-kumo-subtle hover:text-[#E1306C] transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
            セットアップガイド
          </a>
          <Button
            onClick={() => {
              sessionStorage.removeItem('igh_api_key')
              sessionStorage.removeItem('igh_staff_name')
              sessionStorage.removeItem('igh_staff_role')
              window.location.href = '/login'
            }}
            className="flex items-center gap-2 text-xs text-kumo-subtle hover:text-red-500 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            ログアウト
          </Button>
        </div>
      </div>
    </>
  )

  return (
    <>
      {/* Mobile: hamburger header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-50 bg-kumo-base border-b border-kumo-line px-4 py-3 flex items-center gap-3">
        <Button
          onClick={() => setIsOpen(!isOpen)}
          className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg hover:bg-kumo-tint transition-colors"
          aria-label="メニュー" aria-expanded={isOpen}
        >
          <svg className="w-6 h-6 text-kumo-default" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            {isOpen
              ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            }
          </svg>
        </Button>
        <div className="flex items-center gap-2">
          <BrandMark size={28} />
          <p className="text-sm font-bold text-kumo-default">IG Harness</p>
        </div>
      </div>

      {/* Mobile: overlay */}
      {isOpen && <div className="lg:hidden fixed inset-0 z-40 bg-black/50" onClick={() => setIsOpen(false)} />}

      {/* Mobile: slide-in sidebar */}
      <aside className={`lg:hidden fixed top-0 left-0 z-50 w-72 bg-kumo-base flex flex-col h-screen transform transition-transform duration-300 ease-in-out ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="absolute top-4 right-4">
          <Button onClick={() => setIsOpen(false)} className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg hover:bg-kumo-tint" aria-label="閉じる">
            <svg className="w-5 h-5 text-kumo-subtle" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </Button>
        </div>
        {sidebarContent}
      </aside>

      {/* Desktop: always visible */}
      <aside className="hidden lg:flex w-64 bg-kumo-base border-r border-kumo-line flex-col h-screen sticky top-0">
        {sidebarContent}
      </aside>
    </>
  )
}
