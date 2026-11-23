import { NextResponse } from 'next/server'

/**
 * Orders are created only after Stripe payment succeeds (webhook).
 * Use the web or native PaymentIntent checkout endpoints.
 */
export async function POST() {
  return NextResponse.json(
    {
      error:
        'Direct order creation is disabled. Complete payment through checkout — orders are created after payment succeeds.',
    },
    { status: 410 }
  )
}
