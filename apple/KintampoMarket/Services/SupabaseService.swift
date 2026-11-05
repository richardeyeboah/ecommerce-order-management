import Foundation

/// Lightweight Supabase REST client — same tables/RLS as the Next.js storefront.
actor SupabaseService {
    static let shared = SupabaseService()

    private let productSelectFull =
        "id,name,price,image_url,image_urls,category,in_stock,description,created_at,brand,dietary_tags,stock_quantity,unit_amount,unit_of_measure,pack_label,variant_group"
    private let productSelectList =
        "id,name,price,image_url,category,in_stock,created_at,brand,stock_quantity,pack_label"

    private var currentSession: AuthSession?
    private var accessToken: String? { currentSession?.accessToken }
    private var refreshTask: Task<AuthSession, Error>?
    private var generation = 0
    private let baseURL: URL
    private let anonKey: String
    private let persistSession: Bool
    private let session: URLSession

    init(session: URLSession? = nil, baseURL: URL = AppConfig.supabaseURL,
         anonKey: String = AppConfig.supabaseAnonKey, persistSession: Bool = AppConfig.fixtureURL == nil) {
        self.baseURL = baseURL
        self.anonKey = anonKey
        self.persistSession = persistSession
        currentSession = persistSession ? SessionVault.load() : nil
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 20
        config.waitsForConnectivity = true
        // Without this, waitsForConnectivity holds an offline request for 7 days (the default).
        config.timeoutIntervalForResource = 30
        config.httpMaximumConnectionsPerHost = 4
        self.session = session ?? URLSession(configuration: config)
    }

    func signOut() {
        generation += 1
        refreshTask?.cancel()
        refreshTask = nil
        currentSession = nil
        if persistSession { SessionVault.clear() }
    }

    func validSession() async throws -> AuthSession? {
        guard let stored = currentSession else { return nil }
        if !stored.needsRefresh { return stored }
        let version = generation
        if let refreshTask {
            let refreshed = try await refreshTask.value
            guard generation == version else { throw AppError.unauthorized }
            return refreshed
        }
        let task = Task { try await self.requestSession(grant: "refresh_token", body: ["refresh_token": stored.refreshToken]) }
        refreshTask = task
        do {
            let refreshed = try await task.value
            guard generation == version else { throw AppError.unauthorized }
            try store(refreshed)
            refreshTask = nil
            return refreshed
        } catch {
            if generation == version {
                refreshTask = nil
                if case AppError.unauthorized = error { signOut() }
            }
            throw error
        }
    }

    private func store(_ value: AuthSession) throws {
        if persistSession { try SessionVault.save(value) }
        currentSession = value
    }

    func fetchProducts(
        search: String = "",
        category: String? = nil,
        inStockOnly: Bool = false,
        limit: Int = 60,
        listMode: Bool = false
    ) async throws -> [Product] {
        guard !anonKey.isEmpty else { throw AppError.notConfigured }
        var components = URLComponents(url: baseURL.appending(path: "rest/v1/products"), resolvingAgainstBaseURL: false)!
        var queryItems = [
            URLQueryItem(name: "select", value: listMode ? productSelectList : productSelectFull),
            URLQueryItem(name: "order", value: "created_at.desc"),
            URLQueryItem(name: "limit", value: String(limit)),
        ]
        if let category, !category.isEmpty {
            queryItems.append(URLQueryItem(name: "category", value: "eq.\(category)"))
        }
        if inStockOnly { queryItems.append(URLQueryItem(name: "in_stock", value: "eq.true")) }
        if !search.isEmpty { queryItems.append(URLQueryItem(name: "name", value: "ilike.*\(search)*")) }
        components.queryItems = queryItems
        return try await perform(try makeRequest(url: components.url!, method: "GET"))
    }

    func fetchProduct(id: String) async throws -> Product? {
        guard !anonKey.isEmpty else { throw AppError.notConfigured }
        var components = URLComponents(url: baseURL.appending(path: "rest/v1/products"), resolvingAgainstBaseURL: false)!
        components.queryItems = [
            URLQueryItem(name: "select", value: productSelectFull),
            URLQueryItem(name: "id", value: "eq.\(id)"),
            URLQueryItem(name: "limit", value: "1"),
        ]
        let products: [Product] = try await perform(try makeRequest(url: components.url!, method: "GET"))
        return products.first
    }

    func fetchProductsByIDs(_ ids: [String]) async throws -> [Product] {
        guard !ids.isEmpty else { return [] }
        guard !anonKey.isEmpty else { throw AppError.notConfigured }
        var components = URLComponents(url: baseURL.appending(path: "rest/v1/products"), resolvingAgainstBaseURL: false)!
        let inList = "(\(ids.joined(separator: ",")))"
        components.queryItems = [
            URLQueryItem(name: "select", value: productSelectList),
            URLQueryItem(name: "id", value: "in.\(inList)"),
        ]
        return try await perform(try makeRequest(url: components.url!, method: "GET"))
    }

    func signIn(email: String, password: String) async throws -> String {
        try await signInWithSession(email: email, password: password).accessToken
    }

    func signInWithSession(email: String, password: String) async throws -> AuthSession {
        let version = generation
        let result = try await requestSession(grant: "password", body: ["email": email, "password": password])
        guard version == generation else { throw AppError.unauthorized }
        try store(result)
        return result
    }

    /// Sign in with Apple: the identity token from AuthenticationServices plus the raw nonce
    /// whose SHA-256 was sent to Apple.
    func signInWithIdToken(provider: String, idToken: String, nonce: String) async throws -> AuthSession {
        let version = generation
        let result = try await requestSession(grant: "id_token", body: [
            "provider": provider, "id_token": idToken, "nonce": nonce,
        ])
        guard version == generation else { throw AppError.unauthorized }
        try store(result)
        return result
    }

    /// Browser OAuth (Google): authorize URL for the PKCE flow. The callback carries `?code=`.
    nonisolated func oauthAuthorizeURL(provider: String, redirectTo: String, codeChallenge: String) -> URL {
        var components = URLComponents(url: baseURL.appending(path: "auth/v1/authorize"), resolvingAgainstBaseURL: false)!
        components.queryItems = [
            URLQueryItem(name: "provider", value: provider),
            URLQueryItem(name: "redirect_to", value: redirectTo),
            URLQueryItem(name: "code_challenge", value: codeChallenge),
            URLQueryItem(name: "code_challenge_method", value: "s256"),
        ]
        return components.url!
    }

    func exchangeOAuthCode(_ code: String, verifier: String) async throws -> AuthSession {
        let version = generation
        let result = try await requestSession(grant: "pkce", body: ["auth_code": code, "code_verifier": verifier])
        guard version == generation else { throw AppError.unauthorized }
        try store(result)
        return result
    }

    /// Which sign-in providers are switched on in Supabase (`external.google`, `external.apple`).
    func enabledAuthProviders() async throws -> Set<String> {
        guard !anonKey.isEmpty else { throw AppError.notConfigured }
        var request = URLRequest(url: baseURL.appending(path: "auth/v1/settings"))
        request.setValue(anonKey, forHTTPHeaderField: "apikey")
        let (data, _) = try await session.data(for: request)
        struct Settings: Decodable { let external: [String: Bool] }
        let settings = try JSONDecoder().decode(Settings.self, from: data)
        return Set(settings.external.filter(\.value).keys)
    }

    private func requestSession(grant: String, body: [String: String]) async throws -> AuthSession {
        guard !anonKey.isEmpty else { throw AppError.notConfigured }
        var components = URLComponents(url: baseURL.appending(path: "auth/v1/token"), resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "grant_type", value: grant)]
        var request = URLRequest(url: components.url!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(anonKey, forHTTPHeaderField: "apikey")
        request.httpBody = try JSONEncoder().encode(body)
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw AppError.network("No response") }
        guard (200...299).contains(http.statusCode) else {
            if grant == "refresh_token", [400, 401, 403].contains(http.statusCode) { throw AppError.unauthorized }
            throw AppError.network(grant == "password"
                ? "Could not sign in. Check your email and password and try again."
                : "Could not finish signing in. Please try again.")
        }
        struct Response: Decodable {
            let access_token: String
            let refresh_token: String
            let expires_in: Double
            let user: User
            struct User: Decodable { let id: String; let email: String? }
        }
        let auth = try JSONDecoder().decode(Response.self, from: data)
        return AuthSession(accessToken: auth.access_token, refreshToken: auth.refresh_token,
                           expiresAt: Date().addingTimeInterval(auth.expires_in),
                           userId: auth.user.id, email: auth.user.email ?? "")
    }

    func fetchProfile(userID: String) async throws -> UserProfile? {
        guard !anonKey.isEmpty else { throw AppError.notConfigured }
        var components = URLComponents(url: baseURL.appending(path: "rest/v1/profiles"), resolvingAgainstBaseURL: false)!
        components.queryItems = [
            URLQueryItem(name: "select", value: "id,full_name,phone,role"),
            URLQueryItem(name: "id", value: "eq.\(userID)"),
            URLQueryItem(name: "limit", value: "1"),
        ]
        let profiles: [UserProfile] = try await perform(try makeRequest(url: components.url!, method: "GET", authenticated: true))
        return profiles.first
    }

    func updateProfile(userID: String, fullName: String, phone: String) async throws {
        var components = URLComponents(url: baseURL.appending(path: "rest/v1/profiles"), resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "id", value: "eq.\(userID)")]
        var request = try makeRequest(url: components.url!, method: "PATCH", authenticated: true)
        request.setValue("return=minimal", forHTTPHeaderField: "Prefer")
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "full_name": fullName,
            "phone": phone,
        ])
        _ = try await performRaw(request)
    }

    func fetchWishlist() async throws -> [WishlistRow] {
        var components = URLComponents(url: baseURL.appending(path: "rest/v1/wishlists"), resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "select", value: "product_id")]
        return try await perform(try makeRequest(url: components.url!, method: "GET", authenticated: true))
    }

    func addToWishlist(productID: String) async throws {
        var request = try makeRequest(
            url: baseURL.appending(path: "rest/v1/wishlists"),
            method: "POST",
            authenticated: true
        )
        request.setValue("return=minimal", forHTTPHeaderField: "Prefer")
        guard let userId = jwtSubject() else { throw AppError.unauthorized }
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "user_id": userId,
            "product_id": productID,
        ])
        _ = try await performRaw(request)
    }

    func removeFromWishlist(productID: String) async throws {
        var components = URLComponents(url: baseURL.appending(path: "rest/v1/wishlists"), resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "product_id", value: "eq.\(productID)")]
        var request = try makeRequest(url: components.url!, method: "DELETE", authenticated: true)
        request.setValue("return=minimal", forHTTPHeaderField: "Prefer")
        _ = try await performRaw(request)
    }

    func fetchAddresses() async throws -> [SavedAddress] {
        var components = URLComponents(url: baseURL.appending(path: "rest/v1/addresses"), resolvingAgainstBaseURL: false)!
        components.queryItems = [
            URLQueryItem(name: "select", value: "id,user_id,label,full_name,phone,line1,line2,city,state,country,postal_code,is_default"),
            URLQueryItem(name: "order", value: "is_default.desc,created_at.desc"),
        ]
        return try await perform(try makeRequest(url: components.url!, method: "GET", authenticated: true))
    }

    func saveAddress(_ address: SavedAddress) async throws {
        guard let userId = jwtSubject() else { throw AppError.unauthorized }
        var request = try makeRequest(
            url: baseURL.appending(path: "rest/v1/addresses"),
            method: "POST",
            authenticated: true
        )
        request.setValue("return=minimal", forHTTPHeaderField: "Prefer")
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "user_id": userId,
            "label": address.label as Any,
            "full_name": address.fullName,
            "phone": address.phone as Any,
            "line1": address.line1,
            "line2": address.line2 as Any,
            "city": address.city,
            "state": address.state,
            "country": address.country,
            "postal_code": address.postalCode,
            "is_default": address.isDefault,
        ])
        _ = try await performRaw(request)
    }

    func deleteAddress(id: String) async throws {
        var components = URLComponents(url: baseURL.appending(path: "rest/v1/addresses"), resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "id", value: "eq.\(id)")]
        var request = try makeRequest(url: components.url!, method: "DELETE", authenticated: true)
        request.setValue("return=minimal", forHTTPHeaderField: "Prefer")
        _ = try await performRaw(request)
    }

    /// Same rows the website's announcement bar shows; edited from the admin dashboard.
    func fetchAnnouncements() async throws -> [Announcement] {
        var components = URLComponents(url: baseURL.appending(path: "rest/v1/site_announcements"), resolvingAgainstBaseURL: false)!
        components.queryItems = [
            URLQueryItem(name: "select", value: "id,message,href"),
            URLQueryItem(name: "active", value: "eq.true"),
            URLQueryItem(name: "order", value: "sort_order.asc"),
        ]
        return try await perform(try makeRequest(url: components.url!, method: "GET"))
    }

    func fetchBundles() async throws -> [ProductBundle] {
        var components = URLComponents(url: baseURL.appending(path: "rest/v1/product_bundles"), resolvingAgainstBaseURL: false)!
        components.queryItems = [
            URLQueryItem(name: "select", value: "id,slug,name,description,image_url,discount_percent,sort_order"),
            URLQueryItem(name: "active", value: "eq.true"),
            URLQueryItem(name: "order", value: "sort_order.asc"),
        ]
        return try await perform(try makeRequest(url: components.url!, method: "GET"))
    }

    func fetchBundleItems(bundleID: String) async throws -> [BundleItemRow] {
        var components = URLComponents(url: baseURL.appending(path: "rest/v1/product_bundle_items"), resolvingAgainstBaseURL: false)!
        components.queryItems = [
            URLQueryItem(name: "select", value: "product_id,quantity"),
            URLQueryItem(name: "bundle_id", value: "eq.\(bundleID)"),
        ]
        return try await perform(try makeRequest(url: components.url!, method: "GET"))
    }

    func fetchVariants(group: String) async throws -> [Product] {
        let g = group.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !g.isEmpty else { return [] }
        var components = URLComponents(url: baseURL.appending(path: "rest/v1/products"), resolvingAgainstBaseURL: false)!
        components.queryItems = [
            URLQueryItem(name: "select", value: productSelectFull),
            URLQueryItem(name: "variant_group", value: "eq.\(g)"),
        ]
        let rows: [Product] = try await perform(try makeRequest(url: components.url!, method: "GET"))
        return StorefrontCatalog.visible(rows)
    }

    func fetchRelated(category: String, excludeID: String, limit: Int = 8) async throws -> [Product] {
        var components = URLComponents(url: baseURL.appending(path: "rest/v1/products"), resolvingAgainstBaseURL: false)!
        components.queryItems = [
            URLQueryItem(name: "select", value: productSelectList),
            URLQueryItem(name: "category", value: "eq.\(category)"),
            URLQueryItem(name: "id", value: "neq.\(excludeID)"),
            URLQueryItem(name: "in_stock", value: "eq.true"),
            URLQueryItem(name: "limit", value: String(limit)),
        ]
        let rows: [Product] = try await perform(try makeRequest(url: components.url!, method: "GET"))
        return StorefrontCatalog.visible(rows)
    }

    func searchAllProducts(query: String, limit: Int = 80) async throws -> [Product] {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard q.count >= 2 else { return [] }
        return try await fetchProducts(search: q, limit: limit, listMode: true).filter { !StorefrontCatalog.isHidden($0) }
    }

    func fetchReviews(productID: String) async throws -> [ProductReview] {
        var components = URLComponents(url: baseURL.appending(path: "rest/v1/product_reviews"), resolvingAgainstBaseURL: false)!
        components.queryItems = [
            URLQueryItem(name: "select", value: "id,reviewer_name,rating,comment,created_at"),
            URLQueryItem(name: "product_id", value: "eq.\(productID)"),
            URLQueryItem(name: "approved", value: "eq.true"),
            URLQueryItem(name: "order", value: "created_at.desc"),
            URLQueryItem(name: "limit", value: "30"),
        ]
        return try await perform(try makeRequest(url: components.url!, method: "GET"))
    }

    func submitReview(productID: String, name: String, rating: Int, comment: String) async throws {
        var request = try makeRequest(
            url: baseURL.appending(path: "rest/v1/product_reviews"),
            method: "POST",
            authenticated: accessToken != nil
        )
        request.setValue("return=minimal", forHTTPHeaderField: "Prefer")
        var body: [String: Any] = [
            "product_id": productID,
            "reviewer_name": name,
            "rating": rating,
            "comment": comment,
            "approved": false,
        ]
        if let userId = jwtSubject() { body["user_id"] = userId }
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        _ = try await performRaw(request)
    }

    func fetchOrderItems(orderID: String) async throws -> [OrderLineItem] {
        var components = URLComponents(url: baseURL.appending(path: "rest/v1/order_items"), resolvingAgainstBaseURL: false)!
        components.queryItems = [
            URLQueryItem(name: "select", value: "id,product_id,product_name,product_price,quantity"),
            URLQueryItem(name: "order_id", value: "eq.\(orderID)"),
        ]
        return try await perform(try makeRequest(url: components.url!, method: "GET", authenticated: true))
    }

    func fetchRecipes() async throws -> [RecipeSummary] {
        var components = URLComponents(url: baseURL.appending(path: "rest/v1/recipes"), resolvingAgainstBaseURL: false)!
        components.queryItems = [
            URLQueryItem(name: "select", value: "id,slug,title,summary,image_url,prep_minutes,cook_minutes,servings"),
            URLQueryItem(name: "active", value: "eq.true"),
            URLQueryItem(name: "order", value: "sort_order.asc"),
        ]
        return try await perform(try makeRequest(url: components.url!, method: "GET"))
    }

    func fetchRecipe(slug: String) async throws -> RecipeSummary? {
        var components = URLComponents(url: baseURL.appending(path: "rest/v1/recipes"), resolvingAgainstBaseURL: false)!
        components.queryItems = [
            URLQueryItem(name: "select", value: "id,slug,title,summary,body_md,image_url,prep_minutes,cook_minutes,servings"),
            URLQueryItem(name: "slug", value: "eq.\(slug)"),
            URLQueryItem(name: "limit", value: "1"),
        ]
        let rows: [RecipeSummary] = try await perform(try makeRequest(url: components.url!, method: "GET"))
        return rows.first
    }

    func fetchRecipeIngredients(recipeID: String) async throws -> [RecipeIngredientLine] {
        var components = URLComponents(url: baseURL.appending(path: "rest/v1/recipe_ingredients"), resolvingAgainstBaseURL: false)!
        components.queryItems = [
            URLQueryItem(name: "select", value: "id,label,quantity,product_id"),
            URLQueryItem(name: "recipe_id", value: "eq.\(recipeID)"),
            URLQueryItem(name: "order", value: "sort_order.asc"),
        ]
        return try await perform(try makeRequest(url: components.url!, method: "GET"))
    }

    func updatePassword(_ newPassword: String) async throws {
        guard let session = try await validSession() else { throw AppError.unauthorized }
        var request = URLRequest(url: baseURL.appending(path: "auth/v1/user"))
        request.httpMethod = "PUT"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(anonKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(session.accessToken)", forHTTPHeaderField: "Authorization")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["password": newPassword])
        let (_, response) = try await self.session.data(for: request)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            throw AppError.network("Could not update password.")
        }
    }

    /// One page of the signed-in customer's orders, newest first.
    /// Asks for one extra row so the caller knows whether another page exists.
    func fetchMyOrders(offset: Int = 0, pageSize: Int = 20) async throws -> (orders: [TrackedOrder], hasMore: Bool) {
        var components = URLComponents(url: baseURL.appending(path: "rest/v1/orders"), resolvingAgainstBaseURL: false)!
        components.queryItems = [
            URLQueryItem(name: "select", value: "id,order_number,created_at,status,customer_name,customer_email,total_amount,shipping_method,tracking_number"),
            URLQueryItem(name: "order", value: "created_at.desc,id.desc"),
            URLQueryItem(name: "limit", value: String(pageSize + 1)),
            URLQueryItem(name: "offset", value: String(offset)),
        ]
        let rows: [TrackedOrder] = try await perform(try makeRequest(url: components.url!, method: "GET", authenticated: true))
        return (Array(rows.prefix(pageSize)), rows.count > pageSize)
    }

    private func jwtSubject() -> String? {
        guard let accessToken else { return nil }
        let parts = accessToken.split(separator: ".")
        guard parts.count >= 2 else { return nil }
        var base64 = String(parts[1])
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        while base64.count % 4 != 0 { base64 += "=" }
        guard let data = Data(base64Encoded: base64),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let sub = json["sub"] as? String
        else { return nil }
        return sub
    }

    private func makeRequest(url: URL, method: String, authenticated: Bool = false) throws -> URLRequest {
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue(anonKey, forHTTPHeaderField: "apikey")
        if authenticated {
            guard let accessToken else { throw AppError.unauthorized }
            request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        } else {
            request.setValue("Bearer \(anonKey)", forHTTPHeaderField: "Authorization")
        }
        return request
    }

    private func perform<T: Decodable>(_ request: URLRequest) async throws -> T {
        let data = try await performRaw(request)
        do { return try JSONDecoder().decode(T.self, from: data) }
        catch { throw AppError.decode }
    }

    private func performRaw(_ request: URLRequest) async throws -> Data {
        var request = request
        if request.value(forHTTPHeaderField: "Authorization") != "Bearer \(anonKey)" {
            guard let active = try await validSession() else { throw AppError.unauthorized }
            request.setValue("Bearer \(active.accessToken)", forHTTPHeaderField: "Authorization")
        }
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw AppError.network("No response") }
        if http.statusCode == 401 { throw AppError.unauthorized }
        guard (200...299).contains(http.statusCode) else {
            throw AppError.network("Request failed (\(http.statusCode)). Please try again.")
        }
        return data
    }
}
