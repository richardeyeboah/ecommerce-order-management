import Foundation

// Orders, shipping and payments as the store staff see them. Kintampo Manager only.

enum AdminQueue: String, CaseIterable, Identifiable {
    case needsAction = "needs_action"
    case toShip = "to_ship"
    case all
    var id: String { rawValue }
    var label: String {
        switch self {
        case .needsAction: "Needs action"
        case .toShip: "To ship"
        case .all: "All orders"
        }
    }
}

/// Order row from `/api/admin/orders` and the `order` object of `/api/admin/orders/:id`.
/// One page of the admin queue. `counts` (orders per status) comes with the first page only.
struct AdminOrderPage: Decodable, Sendable {
    let orders: [AdminOrder]
    let hasMore: Bool
    let counts: [String: Int]?

    enum CodingKeys: String, CodingKey {
        case orders, counts
        case hasMore = "has_more"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        orders = try c.decode([AdminOrder].self, forKey: .orders)
        // Older servers send neither field: treat as a single complete page.
        hasMore = try c.decodeIfPresent(Bool.self, forKey: .hasMore) ?? false
        counts = try c.decodeIfPresent([String: Int].self, forKey: .counts)
    }
}

struct AdminOrder: Codable, Identifiable, Hashable, Sendable {
    let id: String
    let orderNumber: Int?
    let createdAt: String
    let status: String
    let customerName: String?
    let customerEmail: String?
    let customerPhone: String?
    let totalAmount: Double?
    let shippingMethod: String?
    let trackingNumber: String?
    let paymentStatus: String?
    let addressLine: String?
    let city: String?
    let state: String?
    let postalCode: String?
    let pickupContactName: String?
    // Detail-only fields (`/api/admin/orders/:id` returns the whole row).
    var paymentMethod: String? = nil
    var shippingLabelURL: String? = nil
    var refundedAt: String? = nil
    var refundAmount: Double? = nil
    var stripePaymentIntentID: String? = nil

    enum CodingKeys: String, CodingKey {
        case id, status, city, state
        case paymentMethod = "payment_method"
        case shippingLabelURL = "shipping_label_url"
        case refundedAt = "refunded_at"
        case refundAmount = "refund_amount"
        case stripePaymentIntentID = "stripe_payment_intent_id"
        case orderNumber = "order_number"
        case createdAt = "created_at"
        case customerName = "customer_name"
        case customerEmail = "customer_email"
        case customerPhone = "customer_phone"
        case totalAmount = "total_amount"
        case shippingMethod = "shipping_method"
        case trackingNumber = "tracking_number"
        case paymentStatus = "payment_status"
        case addressLine = "address_line"
        case postalCode = "postal_code"
        case pickupContactName = "pickup_contact_name"
    }

    var displayNumber: String {
        if let orderNumber { return "LQ-\(orderNumber)" }
        return id.prefix(8).uppercased()
    }

    var isPickup: Bool { OrderStatusFlow.isPickup(shippingMethod) }
    var hasLabel: Bool { !(shippingLabelURL ?? "").isEmpty }
    /// Orders that leave by carrier. Pickup and local delivery never need postage.
    var needsCarrierLabel: Bool {
        !isPickup && shippingMethod != ShippingMethodOption.local_delivery.rawValue && status != "cancelled"
    }
    var isUnpaid: Bool { paymentStatus == "unpaid" }
    var isRefunded: Bool { refundedAt != nil }
    /// Refunds go back through Stripe, so only card orders can be refunded from the app.
    var canRefund: Bool { !isRefunded && !(stripePaymentIntentID ?? "").isEmpty && !isUnpaid }
    var refundableAmount: Double { max(0, (totalAmount ?? 0) - (refundAmount ?? 0)) }

    var addressSummary: String {
        [addressLine, city, state, postalCode].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: ", ")
    }
}

struct OrderStatusLog: Codable, Identifiable, Hashable, Sendable {
    let id: String
    let fromStatus: String?
    let toStatus: String
    let changedAt: String
    let changedBy: String?
    let note: String?

    enum CodingKeys: String, CodingKey {
        case id, note
        case fromStatus = "from_status"
        case toStatus = "to_status"
        case changedAt = "changed_at"
        case changedBy = "changed_by"
    }
}

struct AdminOrderDetail: Decodable, Sendable {
    let order: AdminOrder
    let items: [OrderLineItem]
    let logs: [OrderStatusLog]
}

/// Mirrors `lib/order-status.ts` so the app offers only statuses the API will accept.

struct ParcelSize: Codable, Hashable, Sendable {
    var weightLb: Double = 3
    var lengthIn: Double = 12
    var widthIn: Double = 10
    var heightIn: Double = 8

    var summary: String {
        func n(_ v: Double) -> String { v.truncatingRemainder(dividingBy: 1) == 0 ? String(Int(v)) : String(format: "%.1f", v) }
        return "\(n(weightLb)) lb · \(n(lengthIn))×\(n(widthIn))×\(n(heightIn)) in"
    }

    /// Saved box presets so staff pick instead of typing.
    static let presets: [(name: String, size: ParcelSize)] = [
        ("Small box", ParcelSize(weightLb: 2, lengthIn: 10, widthIn: 8, heightIn: 4)),
        ("Medium box", ParcelSize(weightLb: 3, lengthIn: 12, widthIn: 10, heightIn: 8)),
        ("Large box", ParcelSize(weightLb: 10, lengthIn: 18, widthIn: 14, heightIn: 12)),
    ]
}

/// `/api/admin/orders/:id/shipping/usps-rate`.
struct ShippingRate: Decodable, Sendable {
    let price: Double
    let description: String?
    let mailClass: String?
    let provider: String?
}

/// `/api/admin/orders/:id/shipping/usps-label`.
struct ShippingLabelResult: Decodable, Sendable {
    let trackingNumber: String
    let postage: Double?
    let mailClass: String?
    let labelUrl: String?
    let labelPdfBase64: String?
    let customerNotified: Bool?

    var pdf: Data? { labelPdfBase64.flatMap { Data(base64Encoded: $0) } }
}

/// Manual settlement options, matching `MANUAL_SETTLE_OPTIONS` on the website.
enum ManualPaymentMethod: String, CaseIterable, Identifiable, Sendable {
    case cod, zelle, manual
    var id: String { rawValue }
    var label: String {
        switch self {
        case .cod: "Cash"
        case .zelle: "Zelle"
        case .manual: "Card at store / other"
        }
    }
}

// MARK: - Home merchandising
