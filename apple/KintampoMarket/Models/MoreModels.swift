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

struct SuggestedCheckoutAddress: Decodable, Sendable {
    let line1: String
    let city: String
    let state: String
    let country: String
    let postalCode: String
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

// MARK: - Passwords

/// Same five checks as `lib/auth/password-strength.ts` (ASCII classes, like the server's regexes),
/// so the app never accepts a password the website would reject.
enum PasswordPolicy {
    static func longEnough(_ p: String) -> Bool { p.count >= 8 }
    static func hasLower(_ p: String) -> Bool { p.unicodeScalars.contains { ("a"..."z").contains($0) } }
    static func hasUpper(_ p: String) -> Bool { p.unicodeScalars.contains { ("A"..."Z").contains($0) } }
    static func hasDigit(_ p: String) -> Bool { p.unicodeScalars.contains { ("0"..."9").contains($0) } }
    static func hasSymbol(_ p: String) -> Bool {
        p.unicodeScalars.contains { !("a"..."z").contains($0) && !("A"..."Z").contains($0) && !("0"..."9").contains($0) }
    }
    static func isAcceptable(_ p: String) -> Bool {
        longEnough(p) && hasLower(p) && hasUpper(p) && hasDigit(p) && hasSymbol(p)
    }
}

// MARK: - Shipping labels

/// Box size sent with rate and label requests (pounds and inches, like the web dashboard).
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
