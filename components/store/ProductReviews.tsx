'use client'

import { useEffect, useState } from 'react'
import { Star } from 'lucide-react'
import { createClient, isSupabaseBrowserConfigured } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'

type Review = {
  id: string
  rating: number
  comment: string | null
  reviewer_name: string
  created_at: string
}

function StarRating({ value, onChange }: { value: number; onChange?: (n: number) => void }) {
  const [hovered, setHovered] = useState(0)
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type={onChange ? 'button' : undefined}
          onClick={() => onChange?.(n)}
          onMouseEnter={() => onChange && setHovered(n)}
          onMouseLeave={() => onChange && setHovered(0)}
          className={onChange ? 'cursor-pointer' : 'cursor-default pointer-events-none'}
          aria-label={onChange ? `Rate ${n} star${n === 1 ? '' : 's'}` : undefined}
        >
          <Star
            className={`h-5 w-5 transition-colors ${
              n <= (hovered || value)
                ? 'fill-amber-400 text-amber-400'
                : 'fill-earth-200 text-earth-200'
            }`}
          />
        </button>
      ))}
    </div>
  )
}

function AverageStars({ rating, count }: { rating: number; count: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-0.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <Star
            key={n}
            className={`h-4 w-4 ${
              n <= Math.round(rating)
                ? 'fill-amber-400 text-amber-400'
                : 'fill-earth-200 text-earth-200'
            }`}
          />
        ))}
      </div>
      <span className="text-sm font-semibold text-earth-900">{rating.toFixed(1)}</span>
      <span className="text-sm text-earth-500">({count} review{count === 1 ? '' : 's'})</span>
    </div>
  )
}

export function ProductReviews({ productId }: { productId: string }) {
  const [reviews, setReviews] = useState<Review[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [rating, setRating] = useState(0)
  const [comment, setComment] = useState('')
  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [submitted, setSubmitted] = useState(false)

  useEffect(() => {
    if (!isSupabaseBrowserConfigured()) { setLoading(false); return }
    let cancelled = false
    const supabase = createClient()
    supabase
      .from('product_reviews')
      .select('id, rating, comment, reviewer_name, created_at')
      .eq('product_id', productId)
      .eq('approved', true)
      .order('created_at', { ascending: false })
      .limit(20)
      .then(({ data }) => {
        if (cancelled) return
        setReviews((data ?? []) as Review[])
        setLoading(false)
      }, () => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [productId])

  async function submitReview(e: React.FormEvent) {
    e.preventDefault()
    if (rating === 0) { setSubmitError('Please select a star rating.'); return }
    if (!name.trim()) { setSubmitError('Please enter your name.'); return }
    if (!isSupabaseBrowserConfigured()) return

    setSubmitting(true)
    setSubmitError('')
    const supabase = createClient()
    const { data: authData } = await supabase.auth.getUser()
    if (!authData.user) {
      setSubmitting(false)
      setSubmitError('Sign in to submit a product review.')
      return
    }
    const { error } = await supabase.from('product_reviews').insert({
      product_id: productId,
      user_id: authData.user.id,
      rating,
      comment: comment.trim() || null,
      reviewer_name: name.trim(),
      approved: false, // admin approves before showing
    })
    setSubmitting(false)
    if (error) {
      setSubmitError('Could not submit review. Try again.')
      return
    }
    setSubmitted(true)
    setShowForm(false)
  }

  const avg = reviews.length
    ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length
    : 0

  return (
    <section className="border-t border-earth-200 bg-white py-12 sm:py-16">
      <div className="store-container max-w-3xl">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-earth-900">
              Customer reviews
            </h2>
            {reviews.length > 0 && (
              <div className="mt-2">
                <AverageStars rating={avg} count={reviews.length} />
              </div>
            )}
          </div>
          {!showForm && !submitted && (
            <Button type="button" variant="outline" className="min-h-11" onClick={() => setShowForm(true)}>
              Write a review
            </Button>
          )}
        </div>

        {/* Review form */}
        {showForm && (
          <form onSubmit={submitReview} className="mt-6 rounded-xl border border-earth-200 bg-earth-50 p-5 space-y-4">
            <p className="text-sm font-semibold text-earth-900">Your review</p>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-earth-600">Rating</label>
              <StarRating value={rating} onChange={setRating} />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-earth-600">Your name</label>
              <input
                type="text"
                className="form-input w-full"
                placeholder="Your name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={60}
                required
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-earth-600">
                Comment <span className="font-normal text-earth-400">(optional)</span>
              </label>
              <textarea
                className="form-input w-full"
                rows={3}
                placeholder="What did you think of this product?"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                maxLength={500}
              />
            </div>
            {submitError && <p className="text-xs text-red-600">{submitError}</p>}
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={submitting}>
                {submitting ? 'Submitting…' : 'Submit review'}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
            </div>
          </form>
        )}

        {submitted && (
          <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
            ✓ Thanks for your review! It will appear after a quick check.
          </div>
        )}

        {/* Reviews list */}
        {loading ? (
          <p className="mt-6 text-sm text-earth-500">Loading reviews…</p>
        ) : reviews.length === 0 ? (
          <div className="mt-6 rounded-xl border border-dashed border-earth-200 py-10 text-center">
            <p className="text-sm text-earth-500">No reviews yet — be the first!</p>
          </div>
        ) : (
          <ul className="mt-8 space-y-6">
            {reviews.map((r) => (
              <li key={r.id} className="border-b border-earth-100 pb-6 last:border-0">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-earth-900">{r.reviewer_name}</p>
                    <StarRating value={r.rating} />
                  </div>
                  <p className="text-xs text-earth-400">
                    {new Date(r.created_at).toLocaleDateString(undefined, {
                      month: 'short', day: 'numeric', year: 'numeric',
                    })}
                  </p>
                </div>
                {r.comment && (
                  <p className="mt-2 text-sm leading-relaxed text-earth-700">{r.comment}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
