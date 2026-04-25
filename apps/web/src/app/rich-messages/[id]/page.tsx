import EditRichMessageClient from './edit-rich-message-client'

// Static export: emit a single shell under a placeholder id. CF Pages serves
// it for any /rich-messages/<id>/ path; the real id is read from
// useParams() inside the client component at runtime.
export function generateStaticParams() {
  return [{ id: '_' }]
}

export const dynamicParams = false

export default function EditRichMessagePage() {
  return <EditRichMessageClient />
}
