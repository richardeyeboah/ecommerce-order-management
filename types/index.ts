export type Product = {
  id: string
  name: string
  description: string | null
  price: number
  category: string
  image_url: string | null
  image_urls?: string[] | null
  in_stock: boolean
  created_at: string
  /** Optional after grocery-ops.sql */
  brand?: string | null
  dietary_tags?: string[] | null
  stock_quantity?: number | null
  unit_amount?: number | null
  unit_of_measure?: string | null
  pack_label?: string | null
  variant_group?: string | null
  tax_class?: 'grocery_exempt' | 'taxable_general' | 'alcohol' | null
}

export type CartItem = {
  product: Product
  quantity: number
}
