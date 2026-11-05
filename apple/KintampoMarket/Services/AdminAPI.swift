import Foundation
import Observation

/// Store-manager client for `/api/admin/*`.
/// Auth is the same signed `admin_session` cookie the web dashboard uses; URLSession keeps it
/// in the shared cookie store. State-changing calls send `Origin` to pass `assertSameOrigin`.
struct AdminAPI {
    static let shared = AdminAPI()
    var session: URLSession = .shared
    var baseURL: URL = AppConfig.siteURL

    func login(password: String) async throws {
        var request = jsonRequest(path: "api/admin/login", method: "POST")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["password": password])
        _ = try await send(request)
    }

    func logout() async throws {
        _ = try await send(jsonRequest(path: "api/admin/logout", method: "POST"))
    }

    func orders(queue: AdminQueue, status: String?, search: String, offset: Int = 0) async throws -> AdminOrderPage {
        var components = URLComponents(url: baseURL.appending(path: "api/admin/orders"), resolvingAgainstBaseURL: false)!
        var items = [URLQueryItem(name: "queue", value: queue.rawValue)]
        if offset > 0 { items.append(URLQueryItem(name: "offset", value: String(offset))) }
        if let status { items.append(URLQueryItem(name: "status", value: status)) }
        let term = search.trimmingCharacters(in: .whitespacesAndNewlines)
        if !term.isEmpty { items.append(URLQueryItem(name: "q", value: term)) }
        components.queryItems = items
        let data = try await send(URLRequest(url: components.url!))
        return try JSONDecoder().decode(AdminOrderPage.self, from: data)
    }

    func order(id: String) async throws -> AdminOrderDetail {
        let data = try await send(URLRequest(url: baseURL.appending(path: "api/admin/orders/\(id)")))
        return try JSONDecoder().decode(AdminOrderDetail.self, from: data)
    }

    func updateStatus(orderID: String, status: String, trackingNumber: String, note: String) async throws {
        var request = jsonRequest(path: "api/admin/orders/\(orderID)", method: "PATCH")
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "status": status,
            "trackingNumber": trackingNumber.trimmingCharacters(in: .whitespacesAndNewlines),
            "note": note.trimmingCharacters(in: .whitespacesAndNewlines),
        ])
        _ = try await send(request)
    }

    func summary(range: ManagerRange) async throws -> ManagerSummary {
        var components = URLComponents(url: baseURL.appending(path: "api/admin/summary"), resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "range", value: range.rawValue)]
        let data = try await send(URLRequest(url: components.url!))
        return try JSONDecoder().decode(ManagerSummary.self, from: data)
    }

    func products(search: String, filter: InventoryFilter, offset: Int = 0) async throws -> ManagerProductPage {
        var components = URLComponents(url: baseURL.appending(path: "api/admin/products"), resolvingAgainstBaseURL: false)!
        var items: [URLQueryItem] = []
        let term = search.trimmingCharacters(in: .whitespacesAndNewlines)
        if !term.isEmpty { items.append(URLQueryItem(name: "q", value: term)) }
        if filter != .all { items.append(URLQueryItem(name: "filter", value: filter.rawValue)) }
        if offset > 0 { items.append(URLQueryItem(name: "offset", value: String(offset))) }
        components.queryItems = items.isEmpty ? nil : items
        let data = try await send(URLRequest(url: components.url!))
        return try JSONDecoder().decode(ManagerProductPage.self, from: data)
    }

    /// Price, stock count and availability. A stock count also sets in-stock on the server (n > 0).
    func updateProduct(id: String, price: Double, stockQuantity: Int?, inStock: Bool) async throws {
        var request = jsonRequest(path: "api/admin/products/\(id)", method: "PATCH")
        var body: [String: Any] = ["price": price, "in_stock": inStock]
        body["stock_quantity"] = stockQuantity.map { $0 as Any } ?? NSNull()
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        _ = try await send(request)
    }

    func setInStock(id: String, inStock: Bool) async throws {
        var request = jsonRequest(path: "api/admin/products/bulk-stock", method: "POST")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["ids": [id], "in_stock": inStock])
        _ = try await send(request)
    }

    func pendingReviews() async throws -> [ManagerReview] {
        let data = try await send(URLRequest(url: baseURL.appending(path: "api/admin/reviews")))
        struct Response: Decodable { let reviews: [ManagerReview] }
        return try JSONDecoder().decode(Response.self, from: data).reviews
    }

    func approveReview(id: String) async throws {
        _ = try await send(jsonRequest(path: "api/admin/reviews/\(id)/approve", method: "POST"))
    }

    func deleteReview(id: String) async throws {
        _ = try await send(jsonRequest(path: "api/admin/reviews/\(id)", method: "DELETE"))
    }

    // MARK: Shipping and payments

    func shippingRate(orderID: String, parcel: ParcelSize) async throws -> ShippingRate {
        var request = jsonRequest(path: "api/admin/orders/\(orderID)/shipping/usps-rate", method: "POST")
        request.httpBody = try JSONEncoder().encode(["parcel": parcel])
        return try JSONDecoder().decode(ShippingRate.self, from: try await send(request))
    }

    /// Buys postage. Charges the store's Shippo/USPS account; the server saves tracking and the PDF
    /// on the order, marks it shipped and emails the customer.
    func buyLabel(orderID: String, parcel: ParcelSize) async throws -> ShippingLabelResult {
        var request = jsonRequest(path: "api/admin/orders/\(orderID)/shipping/usps-label", method: "POST")
        request.timeoutInterval = 60
        request.httpBody = try JSONEncoder().encode(["parcel": parcel])
        return try JSONDecoder().decode(ShippingLabelResult.self, from: try await send(request))
    }

    /// The saved label PDF (for reprinting).
    func labelPDF(orderID: String) async throws -> Data {
        var request = URLRequest(url: baseURL.appending(path: "api/admin/orders/\(orderID)/shipping/label-file"))
        request.setValue(baseURL.absoluteString, forHTTPHeaderField: "Origin")
        return try await send(request)
    }

    /// Re-sends the status email for the order's current status.
    func notifyCustomer(orderID: String) async throws {
        _ = try await send(jsonRequest(path: "api/admin/orders/\(orderID)/notify", method: "POST"))
    }

    func markPaid(orderID: String, method: ManualPaymentMethod) async throws {
        var request = jsonRequest(path: "api/admin/orders/\(orderID)/mark-paid", method: "POST")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["paymentStatus": "paid", "paymentMethod": method.rawValue])
        _ = try await send(request)
    }

    /// Refunds through Stripe; `amount` in dollars, at most what is left on the order.
    func refund(orderID: String, amount: Double, reason: String) async throws {
        var request = jsonRequest(path: "api/admin/orders/\(orderID)/refund", method: "POST")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["amount": amount, "reason": reason])
        _ = try await send(request)
    }

    private func jsonRequest(path: String, method: String) -> URLRequest {
        var request = URLRequest(url: baseURL.appending(path: path))
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(baseURL.absoluteString, forHTTPHeaderField: "Origin")
        return request
    }

    private func send(_ request: URLRequest) async throws -> Data {
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw AppError.network("No response") }
        if http.statusCode == 401 || http.statusCode == 403 { throw AppError.unauthorized }
        guard (200...299).contains(http.statusCode) else {
            let message = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
            // No JSON error on 404/405 means the website doesn't have this endpoint yet.
            if message == nil, [404, 405].contains(http.statusCode) {
                throw AppError.network("This store manager feature needs the latest website update. Use the web dashboard until it's deployed.")
            }
            throw AppError.network(message ?? "Request failed (\(http.statusCode))")
        }
        return data
    }
}

@Observable
@MainActor
final class AdminStore {
    static let shared = AdminStore()

    var isSignedIn = false
    var checked = false

    /// A stored cookie may still be valid from an earlier launch; probe once.
    func restore() async {
        guard !checked else { return }
        do {
            _ = try await AdminAPI.shared.orders(queue: .needsAction, status: nil, search: "")
            isSignedIn = true
        } catch {
            isSignedIn = false
        }
        checked = true
    }

    func signIn(password: String) async throws {
        try await AdminAPI.shared.login(password: password)
        isSignedIn = true
        checked = true
    }

    func signOut() async {
        try? await AdminAPI.shared.logout()
        isSignedIn = false
    }

    /// Called when any admin request comes back 401/403.
    func sessionExpired() {
        isSignedIn = false
    }
}
