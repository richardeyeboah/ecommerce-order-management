/**
 * Shared validation/normalization for admin product create/update payloads.
 * Supports grocery + fabric/lace fields from grocery-ops.sql.
 */

export const PRODUCT_NAME_MAX = 200
export const PRODUCT_DESCRIPTION_MAX = 5000
export const PRODUCT_CATEGORY_MAX = 100
export const PRODUCT_IMAGE_URL_MAX = 2048
export const PRODUCT_PRICE_MAX = 1_000_000
export const PRODUCT_BRAND_MAX = 120
export const PRODUCT_PACK_LABEL_MAX = 80
export const PRODUCT_VARIANT_GROUP_MAX = 80
export const PRODUCT_UNIT_MEASURE_MAX = 16

const UNIT_MEASURES = new Set(['lb', 'oz', 'kg', 'g', 'ct', 'ml', 'l', 'yd', 'm', 'pc'])
const TAX_CLASSES = new Set(['grocery_exempt', 'taxable_general', 'alcohol'])

export type AdminProductWrite = {
  name: string
  description: string | null
  price: number
  category: string
  image_url: string | null
  image_urls: string[] | null
  in_stock: boolean
  brand: string | null
  pack_label: string | null
  unit_amount: number | null
  unit_of_measure: string | null
  stock_quantity: number | null
  variant_group: string | null
  tax_class: 'grocery_exempt' | 'taxable_general' | 'alcohol' | null
}

export type ParseProductBodyResult =
  | { ok: true; data: Partial<AdminProductWrite>; full: boolean }
  | { ok: false; error: string; status: number }

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const t = value.trim()
  return t.length ? t : null
}

function parseImageUrls(value: unknown): string[] | null {
  if (value == null) return null
  if (!Array.isArray(value)) return null
  const urls = value
    .filter((u): u is string => typeof u === 'string')
    .map((u) => u.trim())
    .filter((u) => u.length > 0 && u.length <= PRODUCT_IMAGE_URL_MAX && /^https?:\/\//i.test(u))
  return urls
}

/**
 * @param mode `create` requires name/category/price; `patch` only includes present keys.
 */
export function parseAdminProductBody(
  body: unknown,
  mode: 'create' | 'patch'
): ParseProductBodyResult {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'Invalid request body.', status: 400 }
  }
  const raw = body as Record<string, unknown>
  const data: Partial<AdminProductWrite> = {}
  const has = (key: string) => Object.prototype.hasOwnProperty.call(raw, key)

  if (mode === 'create' || has('name')) {
    const name = asTrimmedString(raw.name) ?? ''
    if (!name || name.length > PRODUCT_NAME_MAX) {
      return { ok: false, error: 'Name is required (max 200 chars).', status: 400 }
    }
    data.name = name
  }

  if (mode === 'create' || has('category')) {
    const category = asTrimmedString(raw.category) ?? ''
    if (!category || category.length > PRODUCT_CATEGORY_MAX) {
      return { ok: false, error: 'Category is required (max 100 chars).', status: 400 }
    }
    data.category = category
  }

  if (mode === 'create' || has('price')) {
    const priceNumber = typeof raw.price === 'number' ? raw.price : Number(raw.price)
    if (!Number.isFinite(priceNumber) || priceNumber <= 0 || priceNumber > PRODUCT_PRICE_MAX) {
      return { ok: false, error: 'Price must be a positive number.', status: 400 }
    }
    data.price = priceNumber
  }

  if (mode === 'create' || has('description')) {
    const description = typeof raw.description === 'string' ? raw.description.trim() : ''
    if (description.length > PRODUCT_DESCRIPTION_MAX) {
      return { ok: false, error: 'Description is too long.', status: 400 }
    }
    data.description = description || null
  }

  if (mode === 'create' || has('image_url')) {
    const imageUrl = typeof raw.image_url === 'string' ? raw.image_url.trim() : ''
    if (imageUrl.length > PRODUCT_IMAGE_URL_MAX) {
      return { ok: false, error: 'image_url is too long.', status: 400 }
    }
    if (imageUrl && !/^https?:\/\//i.test(imageUrl)) {
      return { ok: false, error: 'image_url must start with http(s)://.', status: 400 }
    }
    data.image_url = imageUrl || null
  }

  if (mode === 'create' || has('image_urls')) {
    const parsed = parseImageUrls(raw.image_urls)
    if (raw.image_urls != null && !Array.isArray(raw.image_urls)) {
      return { ok: false, error: 'image_urls must be an array of URLs.', status: 400 }
    }
    data.image_urls = parsed && parsed.length ? parsed : mode === 'create' ? [] : []
  }

  if (mode === 'create' || has('in_stock')) {
    data.in_stock = raw.in_stock === undefined ? true : Boolean(raw.in_stock)
  }

  if (has('brand') || (mode === 'create' && raw.brand !== undefined)) {
    const brand = asTrimmedString(raw.brand)
    if (brand && brand.length > PRODUCT_BRAND_MAX) {
      return { ok: false, error: 'Brand is too long.', status: 400 }
    }
    data.brand = brand
  }

  if (has('pack_label') || (mode === 'create' && raw.pack_label !== undefined)) {
    const pack = asTrimmedString(raw.pack_label)
    if (pack && pack.length > PRODUCT_PACK_LABEL_MAX) {
      return { ok: false, error: 'Pack label is too long.', status: 400 }
    }
    data.pack_label = pack
  }

  if (has('unit_amount') || (mode === 'create' && raw.unit_amount !== undefined)) {
    if (raw.unit_amount === null || raw.unit_amount === '') {
      data.unit_amount = null
    } else {
      const n = typeof raw.unit_amount === 'number' ? raw.unit_amount : Number(raw.unit_amount)
      if (!Number.isFinite(n) || n <= 0 || n > 100_000) {
        return { ok: false, error: 'Unit amount must be a positive number.', status: 400 }
      }
      data.unit_amount = n
    }
  }

  if (has('unit_of_measure') || (mode === 'create' && raw.unit_of_measure !== undefined)) {
    const m = asTrimmedString(raw.unit_of_measure)?.toLowerCase() ?? null
    if (m && (m.length > PRODUCT_UNIT_MEASURE_MAX || !UNIT_MEASURES.has(m))) {
      return { ok: false, error: 'Unsupported unit of measure.', status: 400 }
    }
    data.unit_of_measure = m
  }

  if (has('stock_quantity') || (mode === 'create' && raw.stock_quantity !== undefined)) {
    if (raw.stock_quantity === null || raw.stock_quantity === '') {
      data.stock_quantity = null
    } else {
      const n = typeof raw.stock_quantity === 'number' ? raw.stock_quantity : Number(raw.stock_quantity)
      if (!Number.isFinite(n) || n < 0 || n > 1_000_000 || !Number.isInteger(n)) {
        return { ok: false, error: 'Stock quantity must be a whole number ≥ 0.', status: 400 }
      }
      data.stock_quantity = n
      data.in_stock = n > 0
    }
  }

  if (has('variant_group') || (mode === 'create' && raw.variant_group !== undefined)) {
    const vg = asTrimmedString(raw.variant_group)
    if (vg && vg.length > PRODUCT_VARIANT_GROUP_MAX) {
      return { ok: false, error: 'Variant group is too long.', status: 400 }
    }
    data.variant_group = vg
  }

  if (has('tax_class') || mode === 'create') {
    const taxClass = asTrimmedString(raw.tax_class)
    if (taxClass && !TAX_CLASSES.has(taxClass)) {
      return { ok: false, error: 'Unsupported product tax class.', status: 400 }
    }
    data.tax_class = taxClass as AdminProductWrite['tax_class']
  }

  if (mode === 'create') {
    if (!data.name || !data.category || data.price == null) {
      return { ok: false, error: 'Name, category, and price are required.', status: 400 }
    }
    return {
      ok: true,
      full: true,
      data: {
        name: data.name,
        category: data.category,
        price: data.price,
        description: data.description ?? null,
        image_url: data.image_url ?? null,
        image_urls: data.image_urls ?? [],
        in_stock: data.in_stock ?? true,
        brand: data.brand ?? null,
        pack_label: data.pack_label ?? null,
        unit_amount: data.unit_amount ?? null,
        unit_of_measure: data.unit_of_measure ?? null,
        stock_quantity: data.stock_quantity ?? null,
        variant_group: data.variant_group ?? null,
        tax_class: data.tax_class ?? null,
      },
    }
  }

  if (Object.keys(data).length === 0) {
    return { ok: false, error: 'No valid fields to update.', status: 400 }
  }
  return { ok: true, full: false, data }
}
