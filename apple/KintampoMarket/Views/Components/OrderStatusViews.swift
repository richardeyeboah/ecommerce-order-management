import SwiftUI

// Order status colours, badges and the step timeline.
// Shared by the customer app and Kintampo Manager.

enum OrderStatusStyle {
    static func color(for status: String) -> Color {
        switch status.lowercased() {
        case "delivered", "picked_up", "completed", "complete": return Brand.success
        case "shipped", "out_for_delivery", "ready_for_pickup", "ready": return Brand.gold
        case "cancelled", "canceled", "refunded", "failed": return Brand.inkMuted
        default: return Brand.red
        }
    }

    static func label(_ status: String) -> String {
        status.replacingOccurrences(of: "_", with: " ").capitalized
    }

    static func dateLabel(_ iso: String) -> String {
        let parser = ISO8601DateFormatter()
        parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let date = parser.date(from: iso) ?? {
            parser.formatOptions = [.withInternetDateTime]
            return parser.date(from: iso)
        }()
        guard let date else { return iso.prefix(10).description }
        return date.formatted(date: .abbreviated, time: .shortened)
    }
}

struct OrderStatusBadge: View {
    let status: String
    var body: some View {
        let color = OrderStatusStyle.color(for: status)
        Text(OrderStatusStyle.label(status))
            .font(.caption2.weight(.semibold))
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(color.opacity(0.12))
            .foregroundStyle(color)
            .clipShape(Capsule())
    }
}

/// Order timeline: every step of the pickup or shipping flow, done steps filled in.
struct OrderProgressView: View {
    let status: String
    let shippingMethod: String?
    var trackingNumber: String?
    /// Staff screens show the steps without the customer-facing sentence.
    var forStaff = false

    private var steps: [String] {
        OrderStatusFlow.isPickup(shippingMethod) ? OrderStatusFlow.pickup : OrderStatusFlow.shipping
    }
    private var currentIndex: Int { steps.firstIndex(of: status) ?? 0 }

    var body: some View {
        if status == "cancelled" {
            Label("This order was cancelled", systemImage: "xmark.octagon.fill")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Brand.red)
                .padding(.vertical, 4)
        } else {
            VStack(alignment: .leading, spacing: 0) {
                Text(headline)
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(Brand.ink)
                if !forStaff {
                    Text(subhead)
                        .font(.subheadline)
                        .foregroundStyle(Brand.inkMuted)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer().frame(height: 14)
                ForEach(Array(steps.enumerated()), id: \.offset) { index, step in
                    stepRow(step, index: index)
                }
                if let trackingNumber, !trackingNumber.isEmpty, let url = OrderStatusFlow.trackingURL(trackingNumber) {
                    Link(destination: url) {
                        HStack {
                            VStack(alignment: .leading, spacing: 1) {
                                Text("Track package").font(.subheadline.weight(.semibold))
                                Text(trackingNumber).font(.caption.monospaced()).foregroundStyle(Brand.inkMuted)
                            }
                            Spacer()
                            Image(systemName: "arrow.up.right").font(.caption.weight(.bold))
                        }
                        .foregroundStyle(Brand.red)
                        .padding(.horizontal, 12)
                        .frame(minHeight: 48)
                        .background(Brand.red.opacity(0.07), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    }
                    .padding(.top, 12)
                }
            }
            .padding(.vertical, 6)
            .accessibilityElement(children: .combine)
        }
    }

    private var headline: String { OrderStatusFlow.label(status, shippingMethod: shippingMethod) }

    private var subhead: String {
        let pickup = OrderStatusFlow.isPickup(shippingMethod)
        switch status {
        case "ordered": return "We have your order and will start on it shortly."
        case "processing": return pickup ? "We're picking your items. We'll tell you when it's ready." : "We're packing your order."
        case "ready_for_pickup": return "Come by \(StoreConfig.address). \(StoreConfig.pickupStatus())."
        case "shipped": return "Your package is on its way."
        case "out_for_delivery": return "Arriving today."
        case "delivered": return pickup ? "Thanks for shopping with us." : "Your package was delivered."
        default: return ""
        }
    }

    private func stepRow(_ step: String, index: Int) -> some View {
        let done = index <= currentIndex
        let isLast = index == steps.count - 1
        return HStack(alignment: .top, spacing: 12) {
            VStack(spacing: 0) {
                ZStack {
                    Circle().fill(done ? Brand.forest : Brand.card)
                    Circle().stroke(done ? Brand.forest : Brand.line, lineWidth: 2)
                    if done {
                        Image(systemName: "checkmark").font(.system(size: 10, weight: .heavy)).foregroundStyle(.white)
                    }
                }
                .frame(width: 20, height: 20)
                if !isLast {
                    Rectangle()
                        .fill(index < currentIndex ? Brand.forest : Brand.line)
                        .frame(width: 2)
                        .frame(minHeight: 22)
                }
            }
            Text(OrderStatusFlow.label(step, shippingMethod: shippingMethod))
                .font(.subheadline.weight(index == currentIndex ? .semibold : .regular))
                .foregroundStyle(done ? Brand.ink : Brand.inkMuted)
                .padding(.top, 1)
            Spacer(minLength: 0)
        }
    }
}
