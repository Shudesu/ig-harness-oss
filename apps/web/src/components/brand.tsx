'use client'

import { useId } from 'react'

/**
 * IG Harness brand mark.
 *
 * A white "H" (Harness) on the brand radial gradient — deliberately NOT a
 * camera glyph: the project was renamed after a Meta trademark complaint,
 * so the mark must not imitate the Instagram app icon. The gradient is the
 * same radial ramp used across marketing assets (marketing/ig-harness-logo).
 *
 * SVG paths render crisply at small sizes where the old bold-text "IG"
 * badge looked heavy and blurry.
 */
export function BrandMark({
  size = 32,
  shape = 'square',
  className,
}: {
  size?: number
  shape?: 'square' | 'circle'
  className?: string
}) {
  // useId keeps gradient ids unique when the mark appears multiple times.
  const gradId = useId()
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      className={className}
      role="img"
      aria-label="IG Harness"
    >
      <defs>
        <radialGradient id={gradId} cx="30%" cy="107%" r="130%">
          <stop offset="0%" stopColor="#FDF497" />
          <stop offset="5%" stopColor="#FDF497" />
          <stop offset="45%" stopColor="#FD5949" />
          <stop offset="60%" stopColor="#D6249F" />
          <stop offset="90%" stopColor="#285AEB" />
        </radialGradient>
      </defs>
      {shape === 'circle' ? (
        <circle cx="24" cy="24" r="24" fill={`url(#${gradId})`} />
      ) : (
        <rect x="0" y="0" width="48" height="48" rx="13" fill={`url(#${gradId})`} />
      )}
      {/* "H" drawn as three rounded strokes — the crossbar reads as the
          link/harness connecting two posts. */}
      <path
        d="M17 15v18M31 15v18M17 24h14"
        stroke="#fff"
        strokeWidth="4.2"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  )
}
