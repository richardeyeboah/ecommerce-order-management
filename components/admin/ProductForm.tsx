'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ExternalLink, ImagePlus, Loader2, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PRODUCT_CATEGORIES } from '@/lib/constants/categories'
import { MAX_UPLOAD_BYTES, shrinkImageForUpload, ImagePrepareError } from '@/lib/admin/shrink-image-upload'

const CATEGORIES = [...PRODUCT_CATEGORIES].sort()

type FormData = {
  name: string
  description: string
  price: string
  category: string
  image_url: string
  image_urls: string[]
  in_stock: boolean
  tax_class: '' | 'grocery_exempt' | 'taxable_general' | 'alcohol'
}

type Props = {
  initialData?: Partial<FormData> & { image_urls?: string[] | null }
  productId?: string
}

export function ProductForm({ initialData, productId }: Props) {
  const router = useRouter()
  const [form, setForm] = useState<FormData>({
    name: initialData?.name ?? '',
    description: initialData?.description ?? '',
    price: initialData?.price ?? '',
    category: initialData?.category ?? CATEGORIES[0],
    image_url: initialData?.image_url ?? '',
    image_urls: initialData?.image_urls?.filter(Boolean) ?? [],
    in_stock: initialData?.in_stock ?? true,
    tax_class: initialData?.tax_class ?? '',
  })
  const [uploading, setUploading] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  function update<K extends keyof FormData>(key: K, value: FormData[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
    setSaved(false)
  }

  async function uploadFile(file: File): Promise<string | null> {
    let prepared: File
    try {
      prepared = await shrinkImageForUpload(file)
    } catch (err) {
      setError(err instanceof ImagePrepareError ? err.message : `"${file.name}" could not be prepared.`)
      return null
    }
    if (prepared.size > MAX_UPLOAD_BYTES) {
      setError(`"${file.name}" is too large to upload. Try a smaller photo.`)
      return null
    }
    const fd = new FormData()
    fd.append('file', prepared)
    const res = await fetch('/api/admin/upload', { method: 'POST', body: fd })
    const raw = await res.text()
    let data: { url?: string; error?: string } = {}
    try {
      data = raw ? (JSON.parse(raw) as { url?: string; error?: string }) : {}
    } catch {
      data = {}
    }
    if (!res.ok || !data.url) {
      const fallback =
        raw && raw.length < 240 && !raw.trimStart().startsWith('<')
          ? raw
          : `Upload failed (${res.status}).`
      setError(data.error || fallback)
      return null
    }
    return data.url
  }

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setError('')
    try {
      const url = await uploadFile(file)
      if (url) update('image_url', url)
    } catch {
      setError('Upload failed — check your connection.')
    } finally {
      setUploading(false)
      // Reset input so the same file can be re-picked after a failure.
      e.target.value = ''
    }
  }

  async function handleExtraImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (!files.length) return
    setUploading(true)
    setError('')
    try {
      const urls: string[] = []
      const failed: string[] = []
      for (const file of files) {
        const url = await uploadFile(file)
        if (url) urls.push(url)
        else failed.push(file.name)
      }
      if (urls.length) {
        setForm((prev) => ({ ...prev, image_urls: [...prev.image_urls, ...urls] }))
        setSaved(false)
      }
      if (failed.length && urls.length) {
        setError(`${failed.length} of ${files.length} photos failed.`)
      }
    } catch {
      setError('Upload failed.')
    } finally {
      setUploading(false)
      // Reset input so same file can be re-selected
      e.target.value = ''
    }
  }

  function removeExtraImage(url: string) {
    update('image_urls', form.image_urls.filter((u) => u !== url))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    const price = parseFloat(form.price)
    if (!Number.isFinite(price) || price <= 0) {
      setError('Enter a valid price greater than $0.')
      return
    }
    if (!form.name.trim()) {
      setError('Product name is required.')
      return
    }

    setLoading(true)
    setError('')
    setSaved(false)

    const payload = { ...form, price, tax_class: form.tax_class || null }
    const url = productId ? `/api/admin/products/${productId}` : '/api/admin/products'
    const method = productId ? 'PATCH' : 'POST'

    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Something went wrong.')
        return
      }
      if (productId) {
        setSaved(true)
        router.refresh()
      } else {
        router.push('/admin/products')
        router.refresh()
      }
    } catch {
      setError('Network error — try again.')
    } finally {
      setLoading(false)
    }
  }

  const descLength = form.description.length
  const isEditing = Boolean(productId)

  return (
    <form onSubmit={handleSubmit} className="admin-card space-y-5">

      {/* Name */}
      <div className="space-y-1.5">
        <label className="form-label" htmlFor="name">
          Name <span className="text-red-500">*</span>
        </label>
        <Input
          id="name"
          required
          maxLength={200}
          placeholder="Product name"
          value={form.name}
          onChange={(e) => update('name', e.target.value)}
        />
        <p className="text-[11px] text-earth-400">{form.name.length}/200</p>
      </div>

      {/* Description */}
      <div className="space-y-1.5">
        <label className="form-label" htmlFor="description">
          Description
          <span className="ml-1.5 font-normal text-earth-400">(helps Google find you)</span>
        </label>
        <textarea
          id="description"
          rows={4}
          maxLength={5000}
          className="form-input"
          placeholder="Short product description"
          value={form.description}
          onChange={(e) => update('description', e.target.value)}
        />
        <p className={`text-[11px] ${descLength > 4500 ? 'text-amber-600' : 'text-earth-400'}`}>
          {descLength}/5000
        </p>
      </div>

      {/* Price + Category */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label className="form-label" htmlFor="price">
            Price (USD) <span className="text-red-500">*</span>
          </label>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-earth-400">$</span>
            <Input
              id="price"
              type="number"
              step="0.01"
              min="0.01"
              max="9999"
              required
              className="pl-7"
              placeholder="0.00"
              value={form.price}
              onChange={(e) => update('price', e.target.value)}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <label className="form-label" htmlFor="category">
            Category <span className="text-red-500">*</span>
          </label>
          <select
            id="category"
            className="form-select"
            value={form.category}
            onChange={(e) => update('category', e.target.value)}
            required
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="form-label" htmlFor="tax_class">Sales tax class</label>
        <select
          id="tax_class"
          className="form-select"
          value={form.tax_class}
          onChange={(e) => update('tax_class', e.target.value as FormData['tax_class'])}
        >
          <option value="">Automatic from category</option>
          <option value="grocery_exempt">Grocery food — tax exempt</option>
          <option value="taxable_general">Taxable merchandise</option>
          <option value="alcohol">Alcohol — taxable</option>
        </select>
        <p className="text-[11px] text-earth-400">
          Use grocery exempt for food. Taxable classes are currently collected only for Ohio orders.
        </p>
      </div>

      {/* Image */}
      <div className="space-y-1.5">
        <label className="form-label">
          Product image
          <span className="ml-1.5 font-normal text-earth-400">(phone photos, PNG, JPEG, WebP, or HEIC)</span>
        </label>
        <div className="flex items-start gap-4">
          <label className={`flex h-28 w-28 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-xl border-2 border-dashed transition-colors ${uploading ? 'border-earth-200 bg-earth-50' : 'border-earth-300 bg-earth-50 hover:border-brand-400 hover:bg-brand-50/30'}`}>
            {form.image_url ? (
              <Image
                src={form.image_url}
                alt="Product preview"
                width={112}
                height={112}
                className="h-full w-full object-cover"
              />
            ) : uploading ? (
              <Loader2 className="h-6 w-6 animate-spin text-earth-400" />
            ) : (
              <ImagePlus className="h-6 w-6 text-earth-400" strokeWidth={1.5} aria-hidden />
            )}
            <input
              type="file"
              accept="image/*,.heic,.heif"
              className="sr-only"
              onChange={handleImageUpload}
              disabled={uploading}
            />
          </label>

          <div className="flex-1 space-y-2 text-sm">
            {uploading && (
              <p className="text-earth-500">Uploading image…</p>
            )}
            {!uploading && form.image_url && (
              <>
                <p className="font-medium text-emerald-700">✓ Image uploaded</p>
                <a
                  href={form.image_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-11 items-center gap-1 text-xs text-brand-700 hover:underline"
                >
                  <ExternalLink className="h-3 w-3" /> View full image
                </a>
                <div>
                  <button
                    type="button"
                    className="text-xs font-medium text-red-600 hover:text-red-700"
                    onClick={() => update('image_url', '')}
                  >
                    Remove image
                  </button>
                </div>
              </>
            )}
            {!uploading && !form.image_url && (
              <p className="text-earth-500">Click to upload a product photo.<br />
                <span className="text-xs text-earth-400">Good photos = more sales.</span>
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Extra images */}
      <div className="space-y-1.5">
        <label className="form-label">
          Extra photos
          <span className="ml-1.5 font-normal text-earth-400">(optional)</span>
        </label>
        <div className="flex flex-wrap gap-2">
          {form.image_urls.map((url, i) => (
            <div key={url} className="relative">
              <div className="relative h-20 w-20 overflow-hidden rounded-lg border border-earth-200 bg-earth-50">
                <Image src={url} alt={`Extra photo ${i + 1}`} fill className="object-cover" sizes="80px" />
              </div>
              <button
                type="button"
                onClick={() => removeExtraImage(url)}
                className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-white shadow hover:bg-red-600"
                aria-label="Remove photo"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
          <label className="flex h-20 w-20 cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-earth-300 bg-earth-50 text-earth-400 hover:border-brand-400 hover:bg-brand-50/20 transition-colors">
            {uploading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <ImagePlus className="h-5 w-5" strokeWidth={1.5} />
            )}
            <input
              type="file"
              accept="image/*,.heic,.heif"
              multiple
              className="sr-only"
              onChange={handleExtraImageUpload}
              disabled={uploading}
            />
          </label>
        </div>
        <p className="text-[11px] text-earth-400">
          Click + to add more photos. Customers see all photos on the product page.
        </p>
      </div>

      {/* In stock toggle */}
      <div className={`flex items-center justify-between rounded-lg border p-4 transition-colors ${form.in_stock ? 'border-emerald-200 bg-emerald-50' : 'border-red-200 bg-red-50'}`}>
        <div>
          <p className={`text-sm font-semibold ${form.in_stock ? 'text-emerald-900' : 'text-red-900'}`}>
            {form.in_stock ? 'In stock — visible to customers' : 'Out of stock — hidden from shop'}
          </p>
          <p className="text-xs text-earth-500 mt-0.5">
            {form.in_stock ? 'Customers can find and buy this product.' : 'Customers cannot purchase this product.'}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={form.in_stock}
          onClick={() => update('in_stock', !form.in_stock)}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-150 ${form.in_stock ? 'bg-emerald-500' : 'bg-earth-300'}`}
        >
          <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform duration-150 ${form.in_stock ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
        </button>
      </div>

      {error && <p className="error" role="alert">{error}</p>}

      {saved && (
        <p className="text-sm font-semibold text-emerald-700">✓ Product updated successfully</p>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t border-earth-100 pt-4">
        <Button type="submit" disabled={loading || uploading} className="min-w-[140px]">
          {loading ? (
            <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving…</>
          ) : isEditing ? 'Update product' : 'Add product'}
        </Button>
        <Button type="button" variant="ghost" onClick={() => router.back()}>
          Cancel
        </Button>
        {isEditing && productId && (
          <Link
            href={`/products/${productId}`}
            target="_blank"
            className="ml-auto inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-brand-700 no-underline hover:text-brand-800"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            View on store
          </Link>
        )}
      </div>
    </form>
  )
}
