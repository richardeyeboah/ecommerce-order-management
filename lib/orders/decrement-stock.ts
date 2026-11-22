import { supabaseAdmin } from '@/lib/supabase-admin'

type SoldLine = { product_id: string | null; quantity: number }

/**
 * Lowers `stock_quantity` for products that track a count, after an order is saved.
 * Products with a null count (in/out only) are left alone; the `in_stock` trigger in
 * grocery-ops.sql flips a product to sold out when its count reaches 0.
 *
 * Call once per newly created order (the fulfillment paths return early for duplicates).
 * Best effort: the order is already paid, so failures are logged, never thrown.
 * Each update is conditional on the count it read, and retried, so two orders for the same
 * product at the same moment cannot both write from the same starting number.
 */
export async function decrementStockForOrder(lines: SoldLine[]): Promise<void> {
  const sold = new Map<string, number>()
  for (const line of lines) {
    const qty = Math.floor(Number(line.quantity))
    if (!line.product_id || !Number.isFinite(qty) || qty <= 0) continue
    sold.set(line.product_id, (sold.get(line.product_id) ?? 0) + qty)
  }
  if (sold.size === 0) return

  await Promise.all(
    [...sold.entries()].map(async ([productId, qty]) => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const { data, error } = await supabaseAdmin
          .from('products')
          .select('stock_quantity')
          .eq('id', productId)
          .maybeSingle()
        if (error) {
          console.error('[stock] read failed', productId, error.message)
          return
        }
        const current = data?.stock_quantity
        if (current === null || current === undefined) return

        const next = Math.max(0, Number(current) - qty)
        const { data: updated, error: updateError } = await supabaseAdmin
          .from('products')
          .update({ stock_quantity: next })
          .eq('id', productId)
          .eq('stock_quantity', current)
          .select('id')
        if (updateError) {
          console.error('[stock] update failed', productId, updateError.message)
          return
        }
        if (updated && updated.length > 0) return
        // Someone else changed the count between read and write; read again.
      }
      console.error('[stock] gave up after concurrent updates', productId)
    })
  )
}
