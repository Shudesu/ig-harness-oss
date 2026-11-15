import { ImageResponse } from 'next/og'

// IG Harness の favicon。白い "H" をブランドグラデーションの上に置く
// （BrandMark と同じ意匠。カメラグリフは商標上の理由で使わない）。
export const size = { width: 64, height: 64 }
export const contentType = 'image/png'
// output: 'export' ではアイコンルートも静的に生成する必要がある
export const dynamic = 'force-static'

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 16,
          background:
            'linear-gradient(135deg, #f09433, #e6683c, #dc2743, #cc2366, #bc1888)',
          color: '#fff',
          fontSize: 36,
          fontWeight: 700,
          lineHeight: 1,
        }}
      >
        H
      </div>
    ),
    { ...size },
  )
}
