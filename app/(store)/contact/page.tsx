import { permanentRedirect } from 'next/navigation'

/** /contact is a common guess; the contact details live on /support. */
export default function ContactPage() {
  permanentRedirect('/support')
}
