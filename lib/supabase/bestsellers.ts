import { supabaseAdmin } from '@/lib/supabase-admin'
import { filterStorefrontProducts } from '@/lib/catalog/public-product-filter'
import type { Product } from '@/types'

/** Top sellers by units from the most recent paid, non-cancelled orders (server-only). */
export async function fetchBestsellers(limit = 8): Promise<Product[]> {
  try {
    // Recent orders first, so the ranking reflects what sells now, not all-time history.
    const { data: orders, error: ordersError } = await supabaseAdmin
      .from('orders')
      .select('id, status, payment_status')
      .order('created_at', { ascending: false })
      .limit(500)
    if (ordersError || !orders?.length) return []

    const orderIds = orders
      .filter((o) => o.status !== 'cancelled' && o.payment_status !== 'unpaid')
      .map((o) => o.id as string)
    if (!orderIds.length) return []

    const units = new Map<string, number>()
    // `in` lists go in the URL; keep each request comfortably short.
    for (let i = 0; i < orderIds.length; i += 150) {
      const { data: rows, error } = await supabaseAdmin
        .from('order_items')
        .select('product_id, quantity')
        .in('order_id', orderIds.slice(i, i + 150))
        .not('product_id', 'is', null)
      if (error) return []
      for (const row of rows ?? []) {
        const id = row.product_id as string
        const qty = Number(row.quantity ?? 0)
        if (!id || !Number.isFinite(qty)) continue
        units.set(id, (units.get(id) ?? 0) + qty)
      }
    }

    // Rank generously: sold-out, deleted and hidden test SKUs are dropped below.
    const topIds = [...units.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, Math.max(limit * 6, 40))
      .map(([id]) => id)

    if (!topIds.length) return []

    const { data: products } = await supabaseAdmin
      .from('products')
      .select('*')
      .in('id', topIds)
      .eq('in_stock', true)

    const byId = new Map(((products ?? []) as Product[]).map((p) => [p.id, p]))
    const ordered = topIds
      .map((id) => byId.get(id))
      .filter((p): p is Product => Boolean(p))

    return filterStorefrontProducts(ordered).slice(0, limit)
  } catch {
    return []
  }
}
