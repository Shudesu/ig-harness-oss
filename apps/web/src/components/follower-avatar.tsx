'use client'

import { useState } from 'react'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? ''

interface FollowerAvatarProps {
  igsid: string | null
  username?: string | null
  displayName?: string | null
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const SIZE_CLASSES: Record<NonNullable<FollowerAvatarProps['size']>, { wh: string; text: string }> = {
  sm: { wh: 'w-7 h-7', text: 'text-[11px]' },
  md: { wh: 'w-9 h-9', text: 'text-sm' },
  lg: { wh: 'w-12 h-12', text: 'text-lg' },
}

export function FollowerAvatar({
  igsid,
  username,
  displayName,
  size = 'md',
  className,
}: FollowerAvatarProps) {
  const [imgError, setImgError] = useState(false)
  const { wh, text } = SIZE_CLASSES[size]
  const initial = (username ?? displayName ?? '?').charAt(0).toUpperCase()

  if (igsid && !imgError) {
    return (
      <img
        src={`${API_URL}/images/profile-pics/${igsid}`}
        alt={username ?? displayName ?? ''}
        className={`${wh} rounded-full object-cover${className ? ` ${className}` : ''}`}
        onError={() => setImgError(true)}
      />
    )
  }

  return (
    <div
      className={`${wh} rounded-full bg-gray-200 flex items-center justify-center${className ? ` ${className}` : ''}`}
    >
      <span className={`text-gray-500 ${text} font-medium`}>{initial}</span>
    </div>
  )
}
