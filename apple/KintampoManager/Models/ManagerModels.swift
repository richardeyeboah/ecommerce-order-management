import Foundation

/// Periods offered on the manager dashboard; raw values match `/api/admin/summary?range=`.
enum ManagerRange: String, CaseIterable, Identifiable, Sendable {
    case today, yesterday
    case week = "7d"
    case month = "30d"

    var id: String { rawValue }
    var label: String {
        switch self {
        case .today: "Today"
        case .yesterday: "Yesterday"
        case .week: "7 days"
        case .month: "30 days"
        }
    }
}

/// `/api/admin/summary` — same revenue rules as the web `/admin` dashboard.
struct ManagerSummary: Decodable, Sendable {
    let range: String
    let label: String
    let gross: Double
    let netRevenue: Double
    let orders: Int
    let units: Double
    let averageOrder: Double
    let unpaidCount: Int
    let previousGross: Double?
    let previousOrders: Int?
    let needsAction: Int
    let readyForPickup: Int
    /// Shipping orders with no tracking yet. Nil from servers before this field existed.
    let toShip: Int?
    let pendingReviews: Int
    let outOfStock: Int
    let lowStock: [LowStockItem]
    let bestSellers: [BestSeller]
    let recentOrders: [AdminOrder]

    struct LowStockItem: Decodable, Identifiable, Sendable {
        let id: String
        let name: String
        let stockQuantity: Int?
        let imageURL: String?
        enum CodingKeys: String, CodingKey {
            case id, name
            case stockQuantity = "stock_quantity"
            case imageURL = "image_url"
        }
    }

    struct BestSeller: Decodable, Identifiable, Sendable {
        let productID: String?
        let name: String
        let units: Double
        let revenue: Double
        var id: String { productID ?? name }
        enum CodingKeys: String, CodingKey {
            case name, units, revenue
            case productID = "product_id"
        }
    }

    enum CodingKeys: String, CodingKey {
        case range, label, gross, orders, units
        case netRevenue = "net_revenue"
        case averageOrder = "average_order"
        case unpaidCount = "unpaid_count"
        case previousGross = "previous_gross"
        case previousOrders = "previous_orders"
        case needsAction = "needs_action"
        case readyForPickup = "ready_for_pickup"
        case toShip = "to_ship"
        case pendingReviews = "pending_reviews"
        case outOfStock = "out_of_stock"
        case lowStock = "low_stock"
        case bestSellers = "best_sellers"
        case recentOrders = "recent_orders"
    }

    /// Percent change in sales vs the previous equal period; nil when there is nothing to compare.
    var grossChange: Double? {
        guard let previousGross, previousGross > 0 else { return nil }
        return (gross - previousGross) / previousGross * 100
    }
}

/// One row of `/api/admin/products` (includes hidden and sold-out items).
struct ManagerProduct: Decodable, Identifiable, Hashable, Sendable {
    let id: String
    var name: String
    var price: Double
    var category: String?
    var brand: String?
    var inStock: Bool
    var stockQuantity: Int?
    var imageURL: String?
    var packLabel: String?

    enum CodingKeys: String, CodingKey {
        case id, name, price, category, brand
        case inStock = "in_stock"
        case stockQuantity = "stock_quantity"
        case imageURL = "image_url"
        case packLabel = "pack_label"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = try c.decode(String.self, forKey: .name)
        // Postgres numeric can arrive as a string.
        if let value = try? c.decode(Double.self, forKey: .price) {
            price = value
        } else {
            price = Double(try c.decode(String.self, forKey: .price)) ?? 0
        }
        category = try c.decodeIfPresent(String.self, forKey: .category)
        brand = try c.decodeIfPresent(String.self, forKey: .brand)
        inStock = try c.decodeIfPresent(Bool.self, forKey: .inStock) ?? false
        stockQuantity = try c.decodeIfPresent(Int.self, forKey: .stockQuantity)
        imageURL = try c.decodeIfPresent(String.self, forKey: .imageURL)
        packLabel = try c.decodeIfPresent(String.self, forKey: .packLabel)
    }

    var stockLabel: String {
        if !inStock { return "Out of stock" }
        guard let stockQuantity else { return "In stock" }
        return "\(stockQuantity) left"
    }
}

enum InventoryFilter: String, CaseIterable, Identifiable, Sendable {
    case all, low, out
    var id: String { rawValue }
    var label: String {
        switch self {
        case .all: "All"
        case .low: "Low stock"
        case .out: "Sold out"
        }
    }
}

struct ManagerProductPage: Decodable, Sendable {
    let products: [ManagerProduct]
    let hasMore: Bool
    enum CodingKeys: String, CodingKey {
        case products
        case hasMore = "has_more"
    }
}

/// `/api/admin/reviews` moderation row.
struct ManagerReview: Decodable, Identifiable, Sendable {
    let id: String
    let productID: String?
    let productName: String?
    let reviewerName: String?
    let rating: Int
    let comment: String?
    let createdAt: String

    enum CodingKeys: String, CodingKey {
        case id, rating, comment
        case productID = "product_id"
        case productName = "product_name"
        case reviewerName = "reviewer_name"
        case createdAt = "created_at"
    }
}
