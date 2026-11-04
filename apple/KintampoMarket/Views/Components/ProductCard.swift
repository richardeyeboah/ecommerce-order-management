import SwiftUI

struct ProductCard: View {
    let product: Product
    var compact = false
    var showQuickAdd = true
    @Bindable private var cart = CartStore.shared
    @Environment(\.dynamicTypeSize) private var typeSize

    init(product: Product, compact: Bool = false, showQuickAdd: Bool = true) {
        self.product = product
        self.compact = compact
        self.showQuickAdd = showQuickAdd
    }

    private var lowStock: Int? {
        guard let qty = product.stockQuantity, qty > 0, qty <= 5 else { return nil }
        return qty
    }

    private var imageHeight: CGFloat {
        let base: CGFloat = compact ? 120 : 160
        return typeSize.isAccessibilitySize ? base * 1.4 : base
    }

    private var inCart: Int { cart.quantity(of: product.id) }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            CachedProductImage(url: product.primaryImageURL, background: Brand.card)
                .frame(height: imageHeight)
                .frame(maxWidth: .infinity)
                .clipped()
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay(alignment: .topLeading) {
                    if !product.effectiveInStock {
                        Pill(text: "Out of stock").padding(8)
                    } else if let lowStock {
                        Pill(text: "Only \(lowStock) left", tint: Brand.redDark).padding(8)
                    }
                }
                .overlay(alignment: .bottomTrailing) {
                    if product.effectiveInStock, showQuickAdd {
                        CardQuantityControl(product: product, quantity: inCart)
                            .padding(6)
                    }
                }

            VStack(alignment: .leading, spacing: 3) {
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Text(product.displayPrice)
                        .font(.headline)
                        .foregroundStyle(Brand.ink)
                        .monospacedDigit()
                        .lineLimit(1)
                        .minimumScaleFactor(0.75)
                    if let unit = product.unitPriceLabel {
                        Text(unit).font(.caption2).foregroundStyle(Brand.inkMuted).lineLimit(1)
                    }
                }
                Text(product.name)
                    .font(.subheadline)
                    .foregroundStyle(Brand.ink)
                    .lineLimit(typeSize.isAccessibilitySize ? 4 : 2)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .frame(minHeight: compact || typeSize.isAccessibilitySize ? 0 : 38, alignment: .top)
                let details = [product.packLabel, product.brand]
                    .compactMap { $0?.trimmingCharacters(in: .whitespaces) }
                    .filter { !$0.isEmpty }
                if !details.isEmpty {
                    Text(details.joined(separator: " · "))
                        .font(.caption)
                        .foregroundStyle(Brand.inkMuted)
                        .lineLimit(1)
                }
            }
        }
        .brandCard(padding: compact ? 8 : 10)
        .opacity(product.effectiveInStock ? 1 : 0.7)
    }
}

/// "+" on a product photo; once the item is in the cart it becomes "– 2 +", so customers
/// adjust quantities from the grid without opening the product.
private struct CardQuantityControl: View {
    let product: Product
    let quantity: Int
    private let side: CGFloat = 44

    var body: some View {
        HStack(spacing: 0) {
            if quantity > 0 {
                button(quantity == 1 ? "trash" : "minus", label: quantity == 1 ? "Remove from cart" : "Decrease quantity") {
                    CartStore.shared.setQuantity(productID: product.id, quantity: quantity - 1)
                }
                Text("\(quantity)")
                    .font(.subheadline.weight(.bold))
                    .monospacedDigit()
                    .frame(minWidth: 20)
                    .contentTransition(.numericText())
                    .accessibilityHidden(true)
            }
            button("plus", label: quantity > 0 ? "Increase quantity" : "Add to cart",
                   disabled: quantity >= product.maxCartQuantity) {
                if quantity == 0 {
                    CartStore.shared.add(product, quantity: 1)
                } else {
                    CartStore.shared.setQuantity(productID: product.id, quantity: quantity + 1)
                }
            }
        }
        .foregroundStyle(quantity > 0 ? .white : Brand.red)
        .background(quantity > 0 ? Brand.red : Brand.card, in: Capsule())
        .shadow(color: .black.opacity(0.15), radius: 3, y: 1)
        .animation(.snappy(duration: 0.18), value: quantity > 0)
        .animation(.snappy(duration: 0.15), value: quantity)
        .sensoryFeedback(.selection, trigger: quantity)
        .accessibilityElement(children: .contain)
    }

    private func button(_ symbol: String, label: String, disabled: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.subheadline.weight(.bold))
                .frame(width: side, height: side)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(disabled)
        .opacity(disabled ? 0.45 : 1)
        .accessibilityLabel(label)
    }
}

struct SkeletonGrid: View {
    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 12)], spacing: 12) {
            ForEach(0..<6, id: \.self) { _ in
                VStack(alignment: .leading, spacing: 8) {
                    RoundedRectangle(cornerRadius: 10).fill(Color.gray.opacity(0.12)).frame(height: 150)
                    RoundedRectangle(cornerRadius: 4).fill(Color.gray.opacity(0.12)).frame(height: 14)
                    RoundedRectangle(cornerRadius: 4).fill(Color.gray.opacity(0.12)).frame(width: 70, height: 14)
                }
                .brandCard()
                .redacted(reason: .placeholder)
            }
        }
    }
}

/// Placeholder list rows shown while store-manager data loads (skeletons, not spinners).
struct SkeletonRows: View {
    var count = 6
    var showsImage = true

    var body: some View {
        ForEach(0..<count, id: \.self) { _ in
            HStack(spacing: 12) {
                if showsImage {
                    RoundedRectangle(cornerRadius: 8).fill(Color.gray.opacity(0.12)).frame(width: 44, height: 44)
                }
                VStack(alignment: .leading, spacing: 6) {
                    RoundedRectangle(cornerRadius: 4).fill(Color.gray.opacity(0.12)).frame(height: 12)
                    RoundedRectangle(cornerRadius: 4).fill(Color.gray.opacity(0.12)).frame(width: 110, height: 10)
                }
                Spacer(minLength: 24)
                RoundedRectangle(cornerRadius: 4).fill(Color.gray.opacity(0.12)).frame(width: 48, height: 12)
            }
            .padding(.vertical, 4)
            .accessibilityHidden(true)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Loading")
    }
}
