'use client'

import type { JSX } from 'react'
import Image from 'next/image'
import { BrandMark } from '@/components/brand'
import type { RichMessageBlock } from '@/lib/api'

/**
 * Visual preview that mirrors how IG DM will render each block.
 * - text blocks: chat bubble
 * - image blocks: image bubble
 * - card blocks: bordered card with image + title + subtitle + buttons
 * - carousel: horizontal strip of cards
 * - quick_replies: bubble + pill buttons below
 *
 * Not pixel-perfect to Instagram's UI — just close enough that the operator
 * can sanity-check layout and copy before running test_send.
 */

function renderBlock(block: RichMessageBlock, idx: number) {
  switch (block.type) {
    case 'text':
      return (
        <div key={idx} className="flex justify-start">
          <div className="max-w-[80%] rounded-2xl rounded-tl-md bg-kumo-tint px-4 py-2 text-sm text-kumo-default whitespace-pre-wrap break-words">
            {block.text || <span className="text-kumo-subtle italic">（空）</span>}
          </div>
        </div>
      )

    case 'image':
      return (
        <div key={idx} className="flex justify-start">
          {block.url ? (
            // next/image needs dimensions; we use fill w/ aspect or fixed max-width.
            // Using plain img to avoid domain configuration overhead.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={block.url}
              alt={block.alt ?? ''}
              className="max-w-[240px] rounded-2xl border border-kumo-line object-cover"
            />
          ) : (
            <div className="w-60 h-40 rounded-2xl bg-kumo-tint flex items-center justify-center text-xs text-kumo-subtle">
              画像URL未設定
            </div>
          )}
        </div>
      )

    case 'card':
      return (
        <div key={idx} className="flex justify-start">
          <div className="w-[260px] rounded-xl border border-kumo-line bg-kumo-base overflow-hidden shadow-sm">
            {block.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={block.image_url} alt="" className="w-full h-40 object-cover" />
            ) : (
              <div className="w-full h-40 bg-gradient-to-br from-pink-100 to-orange-100 flex items-center justify-center text-xs text-kumo-subtle">
                画像なし
              </div>
            )}
            <div className="px-4 py-3">
              <div className="text-sm font-semibold text-kumo-default line-clamp-2">
                {block.title || <span className="text-kumo-subtle">（タイトル未設定）</span>}
              </div>
              {block.subtitle && (
                <div className="mt-1 text-xs text-kumo-subtle line-clamp-2">{block.subtitle}</div>
              )}
            </div>
            <div className="divide-y divide-gray-100 border-t border-kumo-line">
              {block.buttons.map((btn, bi) => (
                <div key={bi} className="px-4 py-2.5 text-center text-sm font-medium" style={{ color: '#0095F6' }}>
                  {btn.label || '（ラベル未設定）'}
                </div>
              ))}
            </div>
          </div>
        </div>
      )

    case 'carousel':
      return (
        <div key={idx} className="flex gap-2 overflow-x-auto pb-2">
          {block.cards.map((card, ci) => (
            <div key={ci} className="shrink-0 w-[220px] rounded-xl border border-kumo-line bg-kumo-base overflow-hidden">
              {card.image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={card.image_url} alt="" className="w-full h-32 object-cover" />
              ) : (
                <div className="w-full h-32 bg-kumo-tint" />
              )}
              <div className="px-3 py-2">
                <div className="text-sm font-semibold text-kumo-default line-clamp-2">{card.title || '（タイトル）'}</div>
                {card.subtitle && <div className="mt-1 text-xs text-kumo-subtle line-clamp-1">{card.subtitle}</div>}
              </div>
              <div className="divide-y divide-gray-100 border-t border-kumo-line">
                {card.buttons.map((btn, bi) => (
                  <div key={bi} className="px-3 py-2 text-center text-sm font-medium" style={{ color: '#0095F6' }}>
                    {btn.label || '（ラベル）'}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )

    case 'quick_replies':
      return (
        <div key={idx} className="space-y-2">
          <div className="flex justify-start">
            <div className="max-w-[80%] rounded-2xl rounded-tl-md bg-kumo-tint px-4 py-2 text-sm text-kumo-default">
              {block.text || <span className="text-kumo-subtle italic">（空）</span>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {block.replies.map((r, ri) => (
              <div key={ri} className="px-3 py-1.5 rounded-full border text-xs font-medium" style={{ borderColor: '#0095F6', color: '#0095F6' }}>
                {r.label || '（ラベル）'}
              </div>
            ))}
          </div>
        </div>
      )

    default:
      return null
  }
}

/**
 * Compact inline renderer for chat bubble context.
 * - text block: plain text paragraph (caller wraps in bubble)
 * - card block: bordered mini-card with optional image thumbnail, bold title, subtitle, button pill chips
 * - image block: small thumbnail
 * - other: muted "[type]" label
 */
export function RichBlocksCompact({ blocks }: { blocks: RichMessageBlock[] }): JSX.Element {
  // Single text block — return p directly so caller bubble renders cleanly
  if (blocks.length === 1 && blocks[0].type === 'text') {
    return (
      <p className="text-[13px] whitespace-pre-wrap break-words leading-relaxed">
        {blocks[0].text}
      </p>
    )
  }

  return (
    <div className="space-y-1.5">
      {blocks.map((block, idx) => {
        if (block.type === 'text') {
          return (
            <p key={idx} className="text-[13px] whitespace-pre-wrap break-words leading-relaxed">
              {block.text}
            </p>
          )
        }
        if (block.type === 'card') {
          return (
            <div key={idx} className="border border-kumo-line rounded-xl overflow-hidden bg-kumo-base text-[13px]">
              {block.image_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={block.image_url} alt="" className="w-full h-12 object-cover" />
              )}
              <div className="px-2 py-1.5">
                <p className="font-semibold text-kumo-default line-clamp-1">{block.title}</p>
                {block.subtitle && (
                  <p className="text-[11px] text-kumo-subtle line-clamp-1">{block.subtitle}</p>
                )}
              </div>
              <div className="flex flex-wrap gap-1 px-2 pb-2">
                {block.buttons.map((btn, i) => (
                  <span
                    key={i}
                    className="text-[11px] px-2 py-0.5 rounded-full border"
                    style={{ borderColor: '#0095F6', color: '#0095F6' }}
                  >
                    {btn.label}
                  </span>
                ))}
              </div>
            </div>
          )
        }
        if (block.type === 'image') {
          return (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={idx}
              src={block.url}
              alt={block.alt ?? ''}
              className="max-w-[160px] rounded-xl border border-kumo-line"
            />
          )
        }
        return (
          <span key={idx} className="text-[11px] text-kumo-subtle">[{block.type}]</span>
        )
      })}
    </div>
  )
}

export default function RichMessagePreview({ blocks }: { blocks: RichMessageBlock[] }) {
  if (blocks.length === 0) {
    return (
      <div className="text-center text-sm text-kumo-subtle py-12">
        ブロックを追加するとプレビューが表示されます
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Simulated DM header */}
      <div className="flex items-center gap-2 pb-2 border-b border-kumo-line">
        <BrandMark size={32} shape="circle" />
        <div className="text-sm font-medium text-kumo-default">Instagram DM プレビュー</div>
      </div>
      {blocks.map((b, i) => renderBlock(b, i))}
    </div>
  )
}
