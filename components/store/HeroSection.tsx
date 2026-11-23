import Image from 'next/image'
import Link from 'next/link'
import { ArrowRight, MapPin, PackageCheck, Truck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { STORE } from '@/lib/constants/store'
import { getCategoryImage } from '@/lib/constants/category-images'

/** Real, in-stock departments only — same photos CategoryBrowse uses below. */
const QUICK_DEPARTMENTS = ['Fresh Produce', 'Meat and Seafood', 'Spices', 'Beverages'] as const

/**
 * Real in-store aisle photo for the ambient wash; the right-side grid links
 * straight into the four highest-traffic departments (utility, not decoration).
 */
export function HeroSection({
  inStockCount,
  departmentCount,
  categoryCount,
  showFashion = false,
}: {
  inStockCount: number
  departmentCount: number
  categoryCount: Record<string, number>
  showFashion?: boolean
}) {
  const stockLabel =
    inStockCount > 0 ? `${inStockCount.toLocaleString()} products in stock` : 'Products in stock'

  return (
    <section
      className="relative overflow-hidden border-b border-earth-200 bg-earth-50"
      aria-label={STORE.name}
    >
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div className="absolute inset-0">
          <Image
            src="/images/hero/grocery-aisle.png"
            alt=""
            fill
            quality={50}
            loading="eager"
            sizes="100vw"
            className="object-cover object-[center_35%] opacity-[0.16]"
          />
        </div>
        <div className="absolute inset-0 bg-gradient-to-r from-white via-white/95 to-white/80" />
        <div className="absolute inset-0 bg-gradient-to-t from-white via-white/50 to-white/90" />
      </div>

      <div className="store-container relative grid items-center gap-10 py-14 sm:py-16 lg:grid-cols-[1.05fr_0.95fr] lg:gap-12 lg:py-20">
        <div>
          <p className="inline-flex items-center gap-1.5 rounded-full border border-earth-200 bg-white/80 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-earth-600">
            <MapPin className="h-3.5 w-3.5 text-brand-600" strokeWidth={2} aria-hidden />
            {STORE.name} · Columbus, OH
          </p>
          <h1 className="mt-5 max-w-xl text-balance text-4xl font-semibold leading-[1.05] tracking-[-0.04em] text-earth-950 sm:text-5xl lg:text-[3.25rem]">
            Ghana &amp; Caribbean groceries — in stock now.
          </h1>
          <p className="mt-4 max-w-lg text-base leading-7 text-earth-600 sm:text-lg">
            {`${inStockCount > 0 ? `${inStockCount.toLocaleString()} products` : 'Groceries'}${
              departmentCount > 0 ? ` across ${departmentCount} departments` : ''
            } from Ghana & the Caribbean. Pickup in Columbus or ships nationwide.`}
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link href="/shop" className="w-full no-underline sm:w-auto">
              <Button
                size="lg"
                className="h-12 w-full bg-brand-600 px-7 text-white hover:bg-brand-700 sm:w-auto"
              >
                Shop all products
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Button>
            </Link>
            {showFashion ? (
              <Link href="/fashion" className="w-full no-underline sm:w-auto">
                <Button size="lg" variant="outline" className="h-12 w-full bg-white/80 px-7 sm:w-auto">
                  Shop fashion
                </Button>
              </Link>
            ) : (
              <Link href="#categories" className="w-full no-underline sm:w-auto">
                <Button size="lg" variant="outline" className="h-12 w-full bg-white/80 px-7 sm:w-auto">
                  Browse categories
                </Button>
              </Link>
            )}
          </div>

          <ul className="mt-8 flex flex-col gap-2.5 text-sm text-earth-700 sm:flex-row sm:flex-wrap sm:gap-x-6 sm:gap-y-2">
            <li className="inline-flex items-center gap-2">
              <PackageCheck className="h-4 w-4 text-brand-600" strokeWidth={1.75} aria-hidden />
              {stockLabel}
            </li>
            <li className="inline-flex items-center gap-2">
              <MapPin className="h-4 w-4 text-brand-600" strokeWidth={1.75} aria-hidden />
              Store pickup in Columbus
            </li>
            <li className="inline-flex items-center gap-2">
              <Truck className="h-4 w-4 text-brand-600" strokeWidth={1.75} aria-hidden />
              Ships within 24h
            </li>
          </ul>
        </div>

        <div>
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-earth-500">
            Shop by department
          </p>
          <div className="grid grid-cols-2 gap-3 sm:gap-4">
            {QUICK_DEPARTMENTS.map((cat, i) => {
              const imageUrl = getCategoryImage(cat)
              const count = categoryCount[cat] ?? 0
              return (
                <Link
                  key={cat}
                  href={`/shop?category=${encodeURIComponent(cat)}`}
                  className={`category-tile group block aspect-[4/5] bg-earth-100 no-underline ${i % 2 === 1 ? 'mt-6 sm:mt-10' : ''}`}
                >
                  {imageUrl && (
                    <Image
                      src={imageUrl}
                      alt={`Shop ${cat}`}
                      fill
                      priority={i === 0}
                      quality={70}
                      sizes="(max-width:1024px) 40vw, 20vw"
                      className="object-cover object-center transition-transform duration-200 group-hover:scale-[1.03]"
                    />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/0 to-black/0" />
                  <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-3">
                    <span className="text-sm font-semibold text-white">{cat}</span>
                    <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/90 text-earth-900 transition-transform duration-150 group-hover:translate-x-0.5">
                      <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                    </span>
                  </div>
                  {count > 0 && (
                    <span className="absolute left-3 top-3 rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-semibold text-earth-700">
                      {count} items
                    </span>
                  )}
                </Link>
              )
            })}
          </div>
        </div>
      </div>
    </section>
  )
}
