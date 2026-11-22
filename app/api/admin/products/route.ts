import { NextRequest, NextResponse } from 'next/server'
import { requireAdminApi } from '@/lib/auth/require-admin-api'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { assertSameOrigin } from '@/lib/security/same-origin'
import { parseAdminProductBody } from '@/lib/admin/product-write'

const INVENTORY_PAGE = 50

/**
 * Inventory list for the native store manager. Includes hidden and out-of-stock items.
 * `q` searches name/category/brand; `filter` = all | out | low (≤5 left); paged by `offset`.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAdminApi()
  if (!auth.ok) return auth.response

  const params = req.nextUrl.searchParams
  // Commas/parens are PostgREST filter syntax and would break the .or() below.
  const q = (params.get('q') ?? '').replace(/[,()%*"\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
  const filter = params.get('filter')
  const offset = Math.min(5000, Math.max(0, Number.parseInt(params.get('offset') ?? '0', 10) || 0))

  let query = supabaseAdmin
    .from('products')
    .select('id, name, price, category, brand, in_stock, stock_quantity, image_url, pack_label')
    .order('name', { ascending: true })
    .range(offset, offset + INVENTORY_PAGE)

  if (q) query = query.or(`name.ilike.%${q}%,category.ilike.%${q}%,brand.ilike.%${q}%`)
  if (filter === 'out') query = query.eq('in_stock', false)
  if (filter === 'low') query = query.eq('in_stock', true).not('stock_quantity', 'is', null).lte('stock_quantity', 5)

  const { data, error } = await query
  if (error) {
    console.error('[admin/products GET] failed:', error.message)
    return NextResponse.json({ error: 'Could not load products.' }, { status: 500 })
  }
  const rows = data ?? []
  return NextResponse.json({
    has_more: rows.length > INVENTORY_PAGE,
    products: rows.slice(0, INVENTORY_PAGE),
  })
}

export async function POST(req: NextRequest) {
  const originCheck = assertSameOrigin(req)
  if (!originCheck.ok) return originCheck.response

  const auth = await requireAdminApi()
  if (!auth.ok) return auth.response

  try {
    const body = await req.json().catch(() => null)
    const parsed = parseAdminProductBody(body, 'create')
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status })
    }

    const row = parsed.data
    const { data, error } = await supabaseAdmin
      .from('products')
      .insert({
        name: row.name,
        description: row.description,
        price: row.price,
        category: row.category,
        image_url: row.image_url,
        image_urls: row.image_urls ?? [],
        in_stock: row.in_stock,
        brand: row.brand,
        pack_label: row.pack_label,
        unit_amount: row.unit_amount,
        unit_of_measure: row.unit_of_measure,
        stock_quantity: row.stock_quantity,
        variant_group: row.variant_group,
        tax_class: row.tax_class,
      })
      .select()
      .single()

    if (error) {
      // Older DBs without grocery-ops columns — retry core fields only when
      // the staff did not send extra photos / fabric fields that would be dropped.
      if (/column|does not exist/i.test(error.message)) {
        const wouldDrop =
          (row.image_urls?.length ?? 0) > 0 ||
          Boolean(row.brand) ||
          Boolean(row.pack_label) ||
          row.unit_amount != null ||
          Boolean(row.unit_of_measure) ||
          row.stock_quantity != null ||
          Boolean(row.variant_group) ||
          Boolean(row.tax_class)
        if (wouldDrop) {
          return NextResponse.json(
            {
              error:
                'This catalog is missing newer product columns, so extra photos, brand, yardage, and stock were not saved. Run grocery-ops.sql, then try again.',
            },
            { status: 500 }
          )
        }
        const { data: fallback, error: fallbackError } = await supabaseAdmin
          .from('products')
          .insert({
            name: row.name,
            description: row.description,
            price: row.price,
            category: row.category,
            image_url: row.image_url,
            in_stock: row.in_stock,
          })
          .select()
          .single()
        if (fallbackError) {
          return NextResponse.json({ error: fallbackError.message }, { status: 500 })
        }
        return NextResponse.json(fallback, { status: 201 })
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json(data, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'Server error.' }, { status: 500 })
  }
}
