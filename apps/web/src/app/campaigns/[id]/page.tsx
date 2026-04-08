import CampaignDetailClient from './campaign-detail-client'

// With `output: 'export'`, Next.js requires `generateStaticParams` on dynamic
// routes. This page is fully client-rendered (data fetched at runtime via
// `engagementGatesApi.get(id)`), so we emit a single shell HTML under a
// placeholder id. CF Pages serves that shell for any /campaigns/<id>/ path;
// the real id is read from `useParams()` inside the client component.
export function generateStaticParams() {
  return [{ id: '_' }]
}

// Disable dynamic params lookup — we only pre-render the placeholder shell.
export const dynamicParams = false

export default function CampaignDetailPage() {
  return <CampaignDetailClient />
}
