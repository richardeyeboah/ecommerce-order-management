import Foundation

struct SavedAddress: Identifiable, Codable, Hashable, Sendable {
    let id: String
    let userId: String?
    var label: String?
    var fullName: String
    var phone: String?
    var line1: String
    var line2: String?
    var city: String
    var state: String
    var country: String
    var postalCode: String
    var isDefault: Bool

    enum CodingKeys: String, CodingKey {
        case id, label, phone, city, state, country
        case userId = "user_id"
        case fullName = "full_name"
        case line1, line2
        case postalCode = "postal_code"
        case isDefault = "is_default"
    }

    var oneLine: String {
        [line1, city, state, postalCode].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: ", ")
    }
}

struct ProductBundle: Identifiable, Codable, Hashable, Sendable {
    let id: String
    let slug: String
    let name: String
    let description: String?
    let imageURL: String?
    let discountPercent: Double
    let sortOrder: Int?

    enum CodingKeys: String, CodingKey {
        case id, slug, name, description
        case imageURL = "image_url"
        case discountPercent = "discount_percent"
        case sortOrder = "sort_order"
    }

    var image: URL? {
        guard let imageURL else { return nil }
        return URL(string: imageURL)
    }
}

struct BundleItemRow: Codable, Sendable {
    let productId: String
    let quantity: Int

    enum CodingKeys: String, CodingKey {
        case productId = "product_id"
        case quantity
    }
}

struct WishlistRow: Codable, Sendable {
    let productId: String

    enum CodingKeys: String, CodingKey {
        case productId = "product_id"
    }
}

struct AuthSession: Codable, Sendable {
    let accessToken: String
    let refreshToken: String
    let expiresAt: Date
    let userId: String
    let email: String

    var needsRefresh: Bool { expiresAt.timeIntervalSinceNow < 60 }
}

struct PaymentIntentResult: Decodable, Sendable {
    let clientSecret: String
    let paymentIntentId: String?
    let publishableKey: String?
    let subtotal: Double
    let shippingFee: Double
    let taxAmount: Double
    let total: Double
    var intentID: String { paymentIntentId ?? clientSecret.components(separatedBy: "_secret_")[0] }
}

struct CheckoutStatusResult: Decodable, Sendable {
    let status: String
    let orderId: String?
    let orderNumber: Int?
    let orderStatus: String?
    let totalAmount: Double?
    let paymentStatus: String?

    var confirmationMessage: String? {
        guard status == "complete", let orderId, !orderId.isEmpty else { return nil }
        let label = orderNumber.map { "LQ-\($0)" } ?? orderId
        return "Order \(label) confirmed."
    }

    var canStartNewPayment: Bool {
        status == "unpaid" && ["requires_payment_method", "canceled"].contains(paymentStatus ?? "")
    }
}

enum ShippingMethodOption: String, CaseIterable, Identifiable {
    case pickup
    case standard
    case express
    case local_delivery

    var id: String { rawValue }

    var label: String {
        switch self {
        case .pickup: return "Store pickup"
        case .standard: return "Standard shipping"
        case .express: return "Express shipping"
        case .local_delivery: return "Local delivery"
        }
    }

    var hint: String {
        switch self {
        case .pickup: return "Free · Columbus store"
        case .standard: return "USPS Ground"
        case .express: return "Faster shipping"
        case .local_delivery: return "$5 · nearby Columbus"
        }
    }
}

enum SubstitutionOption: String, CaseIterable, Identifiable {
    case refund, call, substitute
    var id: String { rawValue }
    var label: String {
        switch self {
        case .refund: return "Refund missing items"
        case .call: return "Call me first"
        case .substitute: return "Substitute similar"
        }
    }
}

enum PickupSlotOption: String, CaseIterable, Identifiable {
    case today_asap, today_afternoon, tomorrow_morning, tomorrow_afternoon
    var id: String { rawValue }
    var label: String {
        switch self {
        case .today_asap: return "Today — ASAP"
        case .today_afternoon: return "Today — after 3pm"
        case .tomorrow_morning: return "Tomorrow — morning"
        case .tomorrow_afternoon: return "Tomorrow — afternoon"
        }
    }
}

// MARK: - Store manager

enum AdminQueue: String, CaseIterable, Identifiable {
    case needsAction = "needs_action"
    case all
    var id: String { rawValue }
    var label: String { self == .needsAction ? "Needs action" : "All orders" }
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

    enum CodingKeys: String, CodingKey {
        case id, status, city, state
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
enum OrderStatusFlow {
    static let shipping = ["ordered", "processing", "shipped", "out_for_delivery", "delivered"]
    static let pickup = ["ordered", "processing", "ready_for_pickup", "delivered"]
    static let all = ["ordered", "processing", "ready_for_pickup", "shipped", "out_for_delivery", "delivered", "cancelled"]

    static func isPickup(_ shippingMethod: String?) -> Bool {
        (shippingMethod ?? "").trimmingCharacters(in: .whitespaces).lowercased() == "pickup"
    }

    /// Linear steps plus `cancelled`, which applies to any order.
    static func choices(for shippingMethod: String?) -> [String] {
        (isPickup(shippingMethod) ? pickup : shipping) + ["cancelled"]
    }

    /// The step after `status`, or nil once the order is finished.
    static func next(after status: String, shippingMethod: String?) -> String? {
        let flow = isPickup(shippingMethod) ? pickup : shipping
        guard let index = flow.firstIndex(of: status), index + 1 < flow.count else { return nil }
        return flow[index + 1]
    }

    /// Carrier tracking page for a label number (Shippo labels are USPS or UPS; FedEx by length).
    static func trackingURL(_ number: String) -> URL? {
        let n = number.filter { !$0.isWhitespace }.uppercased()
        guard !n.isEmpty, let encoded = n.addingPercentEncoding(withAllowedCharacters: .alphanumerics) else { return nil }
        if n.hasPrefix("1Z") { return URL(string: "https://www.ups.com/track?tracknum=\(encoded)") }
        if n.allSatisfy(\.isNumber), [12, 15].contains(n.count) {
            return URL(string: "https://www.fedex.com/fedextrack/?trknbr=\(encoded)")
        }
        return URL(string: "https://tools.usps.com/go/TrackConfirmAction?tLabels=\(encoded)")
    }

    static func label(_ status: String, shippingMethod: String?) -> String {
        if status == "delivered", isPickup(shippingMethod) { return "Picked up" }
        switch status {
        case "ready_for_pickup": return "Ready for pickup"
        case "out_for_delivery": return "Out for delivery"
        default: return status.replacingOccurrences(of: "_", with: " ").capitalized
        }
    }
}

// MARK: - Home merchandising

struct Announcement: Codable, Identifiable, Hashable, Sendable {
    let id: String
    let message: String
    let href: String?

    /// Mirrors the website's fallback bar when the table is empty or unreachable.
    static let fallback: [Announcement] = [
        Announcement(id: "fallback-0", message: "Nationwide shipping · Free standard on $\(StoreConfig.freeShippingThreshold)+ · Pickup in Columbus", href: nil),
        Announcement(id: "fallback-1", message: "Store pickup · \(StoreConfig.address)", href: nil),
    ]
}
