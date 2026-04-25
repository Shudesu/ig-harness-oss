'use client'

import Image from 'next/image'
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
          <div className="max-w-[80%] rounded-2xl rounded-tl-md bg-gray-100 px-4 py-2 text-sm text-gray-800 whitespace-pre-wrap break-words">
            {block.text || <span className="text-gray-400 italic">（空）</span>}
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
              className="max-w-[240px] rounded-2xl border border-gray-200 object-cover"
            />
          ) : (
            <div className="w-60 h-40 rounded-2xl bg-gray-100 flex items-center justify-center text-xs text-gray-400">
              画像URL未設定
            </div>
          )}
        </div>
      )

    case 'card':
      return (
        <div key={idx} className="flex justify-start">
          <div className="w-[260px] rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm">
            {block.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={block.image_url} alt="" className="w-full h-40 object-cover" />
            ) : (
              <div className="w-full h-40 bg-gradient-to-br from-pink-100 to-orange-100 flex items-center justify-center text-xs text-gray-400">
                画像なし
              </div>
            )}
            <div className="px-4 py-3">
              <div className="text-sm font-semibold text-gray-900 line-clamp-2">
                {block.title || <span className="text-gray-400">（タイトル未設定）</span>}
              </div>
              {block.subtitle && (
                <div className="mt-1 text-xs text-gray-500 line-clamp-2">{block.subtitle}</div>
              )}
            </div>
            <div className="divide-y divide-gray-100 border-t border-gray-100">
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
            <div key={ci} className="shrink-0 w-[220px] rounded-xl border border-gray-200 bg-white overflow-hidden">
              {card.image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={card.image_url} alt="" className="w-full h-32 object-cover" />
              ) : (
                <div className="w-full h-32 bg-gray-100" />
              )}
              <div className="px-3 py-2">
                <div className="text-sm font-semibold text-gray-900 line-clamp-2">{card.title || '（タイトル）'}</div>
                {card.subtitle && <div className="mt-1 text-xs text-gray-500 line-clamp-1">{card.subtitle}</div>}
              </div>
              <div className="divide-y divide-gray-100 border-t border-gray-100">
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
            <div className="max-w-[80%] rounded-2xl rounded-tl-md bg-gray-100 px-4 py-2 text-sm text-gray-800">
              {block.text || <span className="text-gray-400 italic">（空）</span>}
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

export default function RichMessagePreview({ blocks }: { blocks: RichMessageBlock[] }) {
  if (blocks.length === 0) {
    return (
      <div className="text-center text-sm text-gray-400 py-12">
        ブロックを追加するとプレビューが表示されます
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Simulated DM header */}
      <div className="flex items-center gap-2 pb-2 border-b border-gray-200">
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold"
          style={{ background: 'linear-gradient(135deg, #f09433, #e6683c, #dc2743, #cc2366, #bc1888)' }}
        >
          IG
        </div>
        <div className="text-sm font-medium text-gray-700">Instagram DM プレビュー</div>
      </div>
      {blocks.map((b, i) => renderBlock(b, i))}
    </div>
  )
}
