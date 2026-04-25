import EditCampaignClient from './edit-campaign-client'

// Static export: emit a single shell under a placeholder id. CF Pages _redirects
// rewrites /campaigns/<uuid>/edit/ to /campaigns/_/edit/, and the client
// component reads the real id from window.location at runtime.
export function generateStaticParams() {
  return [{ id: '_' }]
}

export const dynamicParams = false

export default function EditCampaignPage() {
  return <EditCampaignClient />
}
