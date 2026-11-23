import Foundation

enum CheckoutAPIError: LocalizedError {
    case addressCorrection(SuggestedCheckoutAddress, String)

    var errorDescription: String? {
        switch self {
        case .addressCorrection(_, let message): message
        }
    }
}

/// Next.js API client — search, track, signup, mobile checkout.
struct APIClient {
    static let shared = APIClient()
    var session: URLSession = .shared
    var baseURL: URL = AppConfig.siteURL

    func searchProducts(query: String, limit: Int = 12) async throws -> [Product] {
        var components = URLComponents(url: baseURL.appending(path: "api/search"), resolvingAgainstBaseURL: false)!
        components.queryItems = [
            URLQueryItem(name: "q", value: query),
            URLQueryItem(name: "limit", value: String(limit)),
        ]
        let (data, _) = try await session.data(from: components.url!)
        struct Response: Decodable { let products: [Product] }
        return (try? JSONDecoder().decode(Response.self, from: data))?.products ?? []
    }

    /// Top sellers from real checkout data. Empty when the endpoint is not deployed yet.
    func bestsellers() async -> [Product] {
        guard let (data, response) = try? await session.data(from: baseURL.appending(path: "api/products/bestsellers")),
              let http = response as? HTTPURLResponse, http.statusCode == 200
        else { return [] }
        struct Response: Decodable { let products: [Product] }
        return (try? JSONDecoder().decode(Response.self, from: data))?.products ?? []
    }

    func trackOrder(id: String, email: String) async throws -> (TrackedOrder, [OrderLineItem]) {
        var components = URLComponents(url: baseURL.appending(path: "api/orders/track"), resolvingAgainstBaseURL: false)!
        components.queryItems = [
            URLQueryItem(name: "id", value: id),
            URLQueryItem(name: "email", value: email),
        ]
        let (data, response) = try await session.data(from: components.url!)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            throw AppError.network("Order not found. Check number and email.")
        }
        let decoded = try JSONDecoder().decode(OrderTrackingResponse.self, from: data)
        return (decoded.order, decoded.items ?? [])
    }

    func forgotPassword(email: String) async throws {
        var request = URLRequest(url: baseURL.appending(path: "api/auth/forgot-password"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["email": email, "next": "/account"])
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            let message = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
            throw AppError.network(message ?? "Could not send reset email.")
        }
    }

    func sendFeedback(name: String, email: String, category: String, message: String) async throws {
        var request = URLRequest(url: baseURL.appending(path: "api/feedback"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(AppConfig.siteURL.absoluteString, forHTTPHeaderField: "Origin")
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "name": name,
            "email": email,
            "category": category,
            "message": message,
            "pageUrl": "ios-app",
        ])
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            let message = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
            throw AppError.network(message ?? "Could not send feedback.")
        }
    }

    func signUp(email: String, password: String, firstName: String, lastName: String, phone: String) async throws {
        var request = URLRequest(url: baseURL.appending(path: "api/auth/signup"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(AppConfig.siteURL.absoluteString, forHTTPHeaderField: "Origin")
        let body: [String: Any] = [
            "email": email,
            "password": password,
            "firstName": firstName,
            "lastName": lastName,
            "phone": phone,
            "marketingOptIn": false,
            "termsAccepted": true,
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            let message = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
            throw AppError.network(message ?? "Sign up failed.")
        }
    }

    /// Permanently deletes the signed-in account (`/api/account/delete`).
    func deleteAccount(accessToken: String) async throws {
        var request = URLRequest(url: baseURL.appending(path: "api/account/delete"))
        request.httpMethod = "POST"
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            let message = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
            throw AppError.network(message ?? "Could not delete the account. Please try again.")
        }
    }

    func createPaymentIntent(
        name: String,
        email: String,
        phone: String,
        address1: String,
        address2: String,
        city: String,
        state: String,
        postalCode: String,
        country: String,
        items: [CartItem],
        shippingMethod: String,
        pickupName: String?,
        substitutionPref: String,
        pickupSlot: String?,
        tipAmount: Double,
        accessToken: String?
    ) async throws -> PaymentIntentResult {
        var request = URLRequest(url: baseURL.appending(path: "api/mobile/checkout/payment-intent"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let accessToken {
            request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        }
        let payload: [String: Any] = [
            "name": name,
            "email": email,
            "phone": phone,
            "address1": address1,
            "address2": address2,
            "city": city,
            "state": state,
            "postalCode": postalCode,
            "country": country,
            "shippingMethod": shippingMethod,
            "pickupName": pickupName.map { $0 as Any } ?? NSNull(),
            "substitutionPref": substitutionPref,
            "pickupSlot": pickupSlot.map { $0 as Any } ?? NSNull(),
            "tipAmount": tipAmount,
            "items": items.map { ["product": ["id": $0.product.id], "quantity": $0.quantity] },
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: payload)
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw AppError.network("No response") }
        guard (200...299).contains(http.statusCode) else {
            if let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                let error = obj["error"] as? String ?? "Checkout failed."
                if let suggested = obj["suggested"],
                   JSONSerialization.isValidJSONObject(suggested),
                   let suggestionData = try? JSONSerialization.data(withJSONObject: suggested),
                   let address = try? JSONDecoder().decode(SuggestedCheckoutAddress.self, from: suggestionData) {
                    throw CheckoutAPIError.addressCorrection(address, error)
                }
                throw AppError.network(error)
            }
            throw AppError.network("Checkout failed (\(http.statusCode))")
        }
        return try JSONDecoder().decode(PaymentIntentResult.self, from: data)
    }

    func checkoutStatus(paymentIntentId: String, accessToken: String?) async throws -> CheckoutStatusResult {
        var components = URLComponents(
            url: baseURL.appending(path: "api/mobile/checkout/status"),
            resolvingAgainstBaseURL: false
        )!
        components.queryItems = [URLQueryItem(name: "payment_intent", value: paymentIntentId)]
        var request = URLRequest(url: components.url!)
        if let accessToken {
            request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        }
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            throw AppError.network("Could not confirm payment")
        }
        return try JSONDecoder().decode(CheckoutStatusResult.self, from: data)
    }

    func saveCheckoutInfo(
        fullName: String,
        phone: String,
        address1: String,
        address2: String,
        city: String,
        state: String,
        postalCode: String,
        country: String,
        accessToken: String
    ) async throws {
        var request = URLRequest(url: baseURL.appending(path: "api/account/save-checkout-info"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        request.setValue(AppConfig.siteURL.absoluteString, forHTTPHeaderField: "Origin")
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "fullName": fullName,
            "phone": phone,
            "line1": address1,
            "line2": address2,
            "city": city,
            "state": state,
            "postalCode": postalCode,
            "country": country,
        ])
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            let message = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
            throw AppError.network(message ?? "Could not save checkout details.")
        }
    }
}
