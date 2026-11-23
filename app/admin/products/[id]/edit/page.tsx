import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { ProductForm } from '@/components/admin/ProductForm'
import { requireAdminPage } from '@/lib/auth/require-admin-page'

export default async function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireAdminPage()
  const { id } = await params
  const { data: product } = await supabaseAdmin
    .from('products')
    .select('*, image_urls')
    .eq('id', id)
    .single()

  if (!product) notFound()

  const row = product as typeof product & { image_urls?: string[] | null }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link
          href="/admin/products"
          className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-earth-600 no-underline transition-colors hover:text-earth-900"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Back to products
        </Link>
      </div>
      <div>
        <h1 className="admin-page-title">Edit product</h1>
        <p className="mt-1 text-sm text-earth-500">{product.name}</p>
      </div>
      <ProductForm
        productId={product.id}
        initialData={{
          name: product.name,
          description: product.description ?? '',
          price: String(product.price),
          category: product.category,
          image_url: product.image_url ?? '',
          image_urls: row.image_urls ?? [],
          in_stock: product.in_stock,
          tax_class: product.tax_class ?? '',
        }}
      />
    </div>
  )
}
