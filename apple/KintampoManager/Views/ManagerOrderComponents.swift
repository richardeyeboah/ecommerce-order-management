import SwiftUI

// MARK: - Store manager: order screen building blocks

/// Top of the order screen: number, status, when, how it leaves, total and payment state.
struct OrderSummaryCard: View {
    let order: AdminOrder
    let fulfillment: String

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline) {
                Text(order.displayNumber)
                    .font(.title2.weight(.bold))
                    .foregroundStyle(Brand.ink)
                Spacer()
                AdminStatusBadge(status: order.status, shippingMethod: order.shippingMethod)
            }
            HStack(spacing: 8) {
                HStack(spacing: 5) {
                    Image(systemName: order.isPickup ? "storefront" : "shippingbox")
                    Text(fulfillment).lineLimit(1)
                }
                    .font(.caption.weight(.semibold))
                    .fixedSize()
                    .foregroundStyle(Brand.forest)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(Brand.forest.opacity(0.1), in: Capsule())
                Text(OrderStatusStyle.dateLabel(order.createdAt))
                    .font(.caption)
                    .foregroundStyle(Brand.inkMuted)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            Divider()
            HStack(alignment: .center) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("TOTAL")
                        .font(.caption2.weight(.semibold))
                        .tracking(0.8)
                        .foregroundStyle(Brand.inkMuted)
                    Text(String(format: "$%.2f", order.totalAmount ?? 0))
                        .font(.title.weight(.bold))
                        .foregroundStyle(Brand.ink)
                        .monospacedDigit()
                }
                Spacer()
                paymentPill
            }
        }
        .padding(18)
        // Shadow on the card shape only, so it never blurs the text.
        .background {
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(Brand.card)
                .shadow(color: Brand.cardShadow, radius: 8, y: 2)
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private var paymentPill: some View {
        if order.isRefunded {
            pill(String(format: "Refunded $%.2f", order.refundAmount ?? 0), icon: "arrow.uturn.backward", color: Brand.red)
        } else if order.isUnpaid {
            pill("Unpaid", icon: "clock", color: Brand.gold)
        } else {
            pill("Paid", icon: "checkmark.circle.fill", color: Brand.success)
        }
    }

    private func pill(_ text: String, icon: String, color: Color) -> some View {
        Label(text, systemImage: icon)
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(color)
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
            .background(color.opacity(0.12), in: Capsule())
    }
}

/// One-tap ways to reach the customer. Each tile is its own borderless button so taps
/// inside a Form row don't all fire together.
struct CustomerActionBar: View {
    let order: AdminOrder
    var onEmailUpdate: () -> Void
    @Environment(\.openURL) private var openURL
    @State private var copied = false

    private var phoneDigits: String? {
        guard let phone = order.customerPhone else { return nil }
        let digits = phone.filter { $0.isNumber || $0 == "+" }
        return digits.isEmpty ? nil : digits
    }

    var body: some View {
        HStack(spacing: 8) {
            if let phoneDigits {
                tile("Call", icon: "phone.fill") { open("tel:\(phoneDigits)") }
                tile("Text", icon: "message.fill") { open("sms:\(phoneDigits)") }
            }
            if let email = order.customerEmail, !email.isEmpty {
                tile("Email", icon: "envelope.fill", action: onEmailUpdate)
            }
            if !order.isPickup, !order.addressSummary.isEmpty {
                tile(copied ? "Copied" : "Copy", icon: copied ? "checkmark" : "doc.on.doc") {
                    #if os(iOS)
                    UIPasteboard.general.string = [order.customerName, order.addressSummary]
                        .compactMap { $0 }.joined(separator: "\n")
                    #endif
                    copied = true
                }
                tile("Maps", icon: "map.fill") {
                    let q = order.addressSummary.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
                    open("http://maps.apple.com/?q=\(q)")
                }
            }
        }
        .task(id: copied) {
            guard copied else { return }
            try? await Task.sleep(for: .seconds(1.5))
            copied = false
        }
    }

    private func open(_ raw: String) {
        if let url = URL(string: raw) { openURL(url) }
    }

    private func tile(_ title: String, icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 6) {
                Image(systemName: icon)
                    .font(.headline)
                    .foregroundStyle(Brand.red)
                    .contentTransition(.symbolEffect(.replace))
                Text(title)
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(Brand.ink)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            .frame(maxWidth: .infinity, minHeight: 62)
            .background(Brand.surface, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.borderless)
        .accessibilityLabel(title)
    }
}

/// Items with photos, ticked off while packing. Ticks are kept per order on this device,
/// so leaving the screen mid-pack doesn't lose them.
struct PackListSection: View {
    let items: [OrderLineItem]
    let images: [String: URL]
    let orderID: String

    @State private var packed: Set<String> = []

    private var storageKey: String { "packed-\(orderID)" }
    private var unitCount: Int { items.reduce(0) { $0 + $1.quantity } }

    var body: some View {
        Section {
            if items.isEmpty {
                Text("No line items on this order.").foregroundStyle(Brand.inkMuted)
            }
            ForEach(items) { item in
                let done = packed.contains(item.id)
                Button {
                    toggle(item.id)
                } label: {
                    HStack(spacing: 12) {
                        CachedProductImage(url: item.productId.flatMap { images[$0] }, background: Brand.surface)
                            .frame(width: 52, height: 52)
                            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                            .overlay(alignment: .bottomTrailing) {
                                Text("×\(item.quantity)")
                                    .font(.caption2.weight(.heavy))
                                    .foregroundStyle(.white)
                                    .padding(.horizontal, 5)
                                    .frame(minHeight: 18)
                                    .background(Brand.ink, in: Capsule())
                                    .padding(3)
                            }
                            .opacity(done ? 0.45 : 1)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(item.productName)
                                .font(.subheadline.weight(.medium))
                                .foregroundStyle(done ? Brand.inkMuted : Brand.ink)
                                .strikethrough(done, color: Brand.inkMuted)
                                .lineLimit(2)
                            Text("\(item.quantity) × \(String(format: "$%.2f", item.productPrice))")
                                .font(.caption)
                                .foregroundStyle(Brand.inkMuted)
                                .monospacedDigit()
                        }
                        Spacer(minLength: 8)
                        Image(systemName: done ? "checkmark.circle.fill" : "circle")
                            .font(.title2)
                            .foregroundStyle(done ? Brand.success : Brand.line)
                            .contentTransition(.symbolEffect(.replace))
                    }
                    .padding(.vertical, 4)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\(item.quantity) \(item.productName)")
                .accessibilityValue(done ? "Packed" : "Not packed")
                .accessibilityHint("Double-tap to mark packed")
            }
        } header: {
            HStack {
                Text("Pack list")
                Spacer()
                Text("\(unitCount) item\(unitCount == 1 ? "" : "s")")
            }
        } footer: {
            if !items.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    ProgressView(value: Double(packed.count), total: Double(max(items.count, 1)))
                        .tint(packed.count == items.count ? Brand.success : Brand.forest)
                    Text(packed.count == items.count ? "All packed." : "Tap each item as it goes in the bag or box.")
                }
            }
        }
        .onAppear {
            let saved = UserDefaults.standard.stringArray(forKey: storageKey) ?? []
            packed = Set(saved).intersection(items.map(\.id))
        }
        .sensoryFeedback(.selection, trigger: packed)
    }

    private func toggle(_ id: String) {
        withAnimation(.easeOut(duration: 0.15)) {
            if packed.contains(id) { packed.remove(id) } else { packed.insert(id) }
        }
        UserDefaults.standard.set(Array(packed), forKey: storageKey)
    }
}
