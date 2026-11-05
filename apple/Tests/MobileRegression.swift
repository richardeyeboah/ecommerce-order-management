import Foundation

final class MockHTTP: URLProtocol, @unchecked Sendable {
    static let lock = NSLock()
    static var handler: ((URLRequest) throws -> (Int, String))!
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do {
            Self.lock.lock()
            let result: (Int, String)
            do { result = try Self.handler(request); Self.lock.unlock() }
            catch { Self.lock.unlock(); throw error }
            let response = HTTPURLResponse(url: request.url!, statusCode: result.0, httpVersion: nil,
                                           headerFields: ["Content-Type": "application/json"])!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: Data(result.1.utf8))
            client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() {}
}

@main struct MobileRegression {
    static var checks = 0
    static func check(_ condition: Bool, _ message: String) {
        precondition(condition, message)
        checks += 1
    }
    static func decode<T: Decodable>(_ value: String, as type: T.Type) throws -> T {
        try JSONDecoder().decode(type, from: Data(value.utf8))
    }
    static func product(_ id: String, stock: Int? = nil) throws -> Product {
        try decode("""
        {"id":"\(id)","name":"Yam","price":5,"category":"Produce","in_stock":true,"created_at":"2026-01-01","stock_quantity":\(stock.map(String.init) ?? "null")}
        """, as: Product.self)
    }
    @MainActor static func main() async throws {
        let suite = "kintampo-tests-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let cart = CartStore(defaults: defaults)
        let limited = try product("limited", stock: 2)
        cart.add(limited, quantity: 50)
        check(cart.itemCount == 2, "Stock must cap additions")
        cart.add(limited)
        check(cart.itemCount == 2, "Repeated additions must respect stock")
        cart.setQuantity(productID: limited.id, quantity: 99)
        check(cart.itemCount == 2, "Stepper must respect stock")
        cart.add(try product("empty", stock: 0))
        check(cart.items.count == 1, "Out of stock must not enter cart")
        cart.add(try product("unlimited"), quantity: Int.max)
        check(cart.items.last?.quantity == 99, "Global limit must apply without overflow")
        cart.add(try product("third"))
        cart.remove(at: IndexSet([0, 2]))
        check(cart.items.map(\.product.id) == ["unlimited"], "Batch deletion must use original indexes")
        check(CartStore(defaults: defaults).items == cart.items, "Cart must persist")

        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [MockHTTP.self]
        let session = URLSession(configuration: config)
        let api = APIClient(session: session, baseURL: URL(string: "https://fixture.invalid")!)
        MockHTTP.handler = { _ in (200, """
        {"order":{"id":"order-1","order_number":1042,"created_at":"2026-01-01","status":"ordered"},"items":[],"logs":[]}
        """) }
        let order = try await api.trackOrder(id: "LQ-1042", email: "fixture@example.com")
        check(order.0.id == "order-1", "Tracking must decode nested order")
        for json in ["{\"status\":\"processing\"}", "{\"status\":\"complete\"}", "{\"status\":\"unpaid\",\"paymentStatus\":\"processing\"}"] {
            let status = try decode(json, as: CheckoutStatusResult.self)
            check(status.confirmationMessage == nil, "Unconfirmed status must never signal success")
            check(!status.canStartNewPayment, "Unresolved payment must not permit another charge")
        }
        let completed = try decode("{\"status\":\"complete\",\"orderId\":\"order-1\"}", as: CheckoutStatusResult.self)
        check(completed.confirmationMessage != nil, "Confirmed order must complete")
        let retry = try decode("{\"status\":\"unpaid\",\"paymentStatus\":\"requires_payment_method\"}", as: CheckoutStatusResult.self)
        check(retry.canStartNewPayment, "Declined payment may be retried")

        var refreshes = 0
        MockHTTP.handler = { request in
            if request.url!.query!.contains("refresh_token") {
                refreshes += 1
                return (200, "{\"access_token\":\"renewed\",\"refresh_token\":\"rotated\",\"expires_in\":3600,\"user\":{\"id\":\"user-1\",\"email\":\"fixture@example.com\"}}")
            }
            return (200, "{\"access_token\":\"expired\",\"refresh_token\":\"refresh\",\"expires_in\":0,\"user\":{\"id\":\"user-1\"}}")
        }
        let service = SupabaseService(session: session, baseURL: URL(string: "https://fixture.invalid")!, anonKey: "test", persistSession: false)
        _ = try await service.signInWithSession(email: "fixture@example.com", password: "fixture-only")
        async let first = service.validSession()
        async let second = service.validSession()
        let (a, b) = try await (first, second)
        check(a?.accessToken == "renewed" && b?.accessToken == "renewed", "Expired tokens must refresh")
        check(refreshes == 1, "Concurrent requests must share refresh")
        check(a?.refreshToken == "rotated", "Rotated refresh token must replace old token")
        await service.signOut()
        let signedOut = try await service.validSession()
        check(signedOut == nil, "Sign out must clear session")
        _ = try await service.signInWithSession(email: "fixture@example.com", password: "fixture-only")
        MockHTTP.handler = { _ in (400, "{\"error\":\"invalid_grant\"}") }
        do { _ = try await service.validSession(); preconditionFailure("Revoked refresh must fail") }
        catch AppError.unauthorized { checks += 1 }
        let revoked = try await service.validSession()
        check(revoked == nil, "Revoked session must not remain signed in")
        let admin = AdminAPI(session: session, baseURL: URL(string: "https://fixture.invalid")!)
        var loginOrigin: String?
        MockHTTP.handler = { request in
            loginOrigin = request.value(forHTTPHeaderField: "Origin")
            return (401, "{\"error\":\"Invalid password.\"}")
        }
        do { try await admin.login(password: "wrong"); preconditionFailure("Bad admin password must fail") }
        catch AppError.unauthorized { checks += 1 }
        check(loginOrigin == "https://fixture.invalid", "Admin writes must send Origin for the same-origin guard")
        var listQuery: String?
        MockHTTP.handler = { request in
            listQuery = request.url?.query
            return (200, """
            {"queue":"all","has_more":true,"counts":{"ordered":3,"processing":1},"orders":[{"id":"o-1","order_number":1001,"created_at":"2026-01-01T00:00:00Z","status":"ordered","total_amount":15.5,"shipping_method":"pickup"}]}
            """)
        }
        let queue = try await admin.orders(queue: .all, status: nil, search: " LQ-1001 ")
        check(queue.orders.first?.totalAmount == 15.5 && queue.orders.first?.isPickup == true, "Admin queue must decode orders")
        check(queue.hasMore && queue.counts?["ordered"] == 3, "Admin queue must decode paging and status counts")
        check(listQuery?.contains("q=LQ-1001") == true, "Admin search must send the trimmed term")
        check(listQuery?.contains("offset") == false, "First admin page must not send an offset")
        MockHTTP.handler = { request in
            listQuery = request.url?.query
            return (200, "{\"queue\":\"all\",\"orders\":[]}")
        }
        let older = try await admin.orders(queue: .all, status: nil, search: "", offset: 50)
        check(listQuery?.contains("offset=50") == true && !older.hasMore && older.counts == nil, "Next admin page must send offset; old servers mean no more pages")
        MockHTTP.handler = { _ in (200, """
        {"order":{"id":"o-1","order_number":1001,"created_at":"2026-01-01T00:00:00Z","status":"processing","total_amount":15.5,"shipping_method":"pickup"},
         "items":[{"id":"i-1","product_id":null,"product_name":"Yam","product_price":5,"quantity":3}],
         "logs":[{"id":"l-1","from_status":"ordered","to_status":"processing","changed_at":"2026-01-01T01:00:00Z","changed_by":"admin","note":null}]}
        """) }
        let detail = try await admin.order(id: "o-1")
        check(detail.order.displayNumber == "LQ-1001" && detail.items.count == 1 && detail.logs.count == 1, "Admin order detail must decode")
        check(OrderStatusFlow.next(after: "processing", shippingMethod: "pickup") == "ready_for_pickup", "Pickup flow must go to ready for pickup")
        check(OrderStatusFlow.next(after: "processing", shippingMethod: "standard") == "shipped", "Shipping flow must go to shipped")
        check(!OrderStatusFlow.choices(for: "pickup").contains("shipped"), "Pickup orders must not offer carrier statuses")
        check(OrderStatusFlow.next(after: "delivered", shippingMethod: nil) == nil, "Finished orders have no next step")
        check(OrderStatusFlow.label("delivered", shippingMethod: "pickup") == "Picked up", "Collected pickup orders read as picked up")
        check(StoreConfig.matches("Lace", filter: StoreConfig.fashionGroup), "Fashion filter must include lace")
        check(!StoreConfig.matches("Spices", filter: StoreConfig.fashionGroup), "Fashion filter must exclude groceries")
        var summaryQuery: String?
        MockHTTP.handler = { request in
            summaryQuery = request.url?.query
            return (200, """
            {"range":"7d","label":"Last 7 days","gross":250,"net_revenue":240,"orders":5,"units":12,"average_order":50,
             "unpaid_count":0,"previous_gross":200,"previous_orders":4,"needs_action":3,"ready_for_pickup":1,
             "pending_reviews":2,"out_of_stock":7,"low_stock":[{"id":"p-1","name":"Gari","stock_quantity":2,"image_url":null}],
             "best_sellers":[{"product_id":"p-1","name":"Gari","units":6,"revenue":60}],
             "recent_orders":[{"id":"o-1","order_number":1001,"created_at":"2026-01-01T00:00:00Z","status":"ordered","customer_name":"Ama","total_amount":15.5,"shipping_method":"pickup"}]}
            """)
        }
        let summary = try await admin.summary(range: .week)
        check(summaryQuery == "range=7d", "Dashboard must request the chosen period")
        check(summary.grossChange == 25 && summary.lowStock.first?.stockQuantity == 2 && summary.recentOrders.count == 1,
              "Dashboard must decode sales, change, stock alerts and recent orders")
        MockHTTP.handler = { _ in (200, """
        {"has_more":false,"products":[{"id":"p-1","name":"Gari","price":"4.50","category":"Flours","in_stock":true,"stock_quantity":null}]}
        """) }
        let stock = try await admin.products(search: "", filter: .all)
        check(stock.products.first?.price == 4.5 && stock.products.first?.stockLabel == "In stock",
              "Inventory must decode numeric-string prices and untracked stock")
        var patchBody: [String: Any]?
        MockHTTP.handler = { request in
            patchBody = request.httpBodyStream.flatMap { stream -> [String: Any]? in
                stream.open(); defer { stream.close() }
                var data = Data(); var buffer = [UInt8](repeating: 0, count: 1024)
                while stream.hasBytesAvailable { let n = stream.read(&buffer, maxLength: 1024); if n <= 0 { break }; data.append(buffer, count: n) }
                return try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            } ?? request.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
            return (200, "{}")
        }
        try await admin.updateProduct(id: "p-1", price: 5, stockQuantity: nil, inStock: false)
        check(patchBody?["stock_quantity"] is NSNull && patchBody?["in_stock"] as? Bool == false,
              "Untracked stock must send null so the in-stock switch is respected")
        check(StoreConfig.matches("Spices", filter: "Spices"), "Plain category filter must match exactly")
        let wa = StoreConfig.whatsAppURL(message: "Hi & hello")?.absoluteString ?? ""
        check(wa.hasPrefix("https://wa.me/1") && wa.contains("text=Hi%20%26%20hello"), "WhatsApp link must add +1 and encode the message")
        func shelfProduct(_ id: String, _ name: String, _ category: String, day: Int, image: Bool = true, stock: Bool = true) throws -> Product {
            let imageJSON = image ? "\"https://x.invalid/\(id).jpg\"" : "null"
            return try decode("""
            {"id":"\(id)","name":"\(name)","price":5,"category":"\(category)","in_stock":\(stock),"created_at":"2026-01-0\(day)","image_url":\(imageJSON)}
            """, as: Product.self)
        }
        let shelf = [
            try shelfProduct("a", "Neat Fufu", "Flours & Rice", day: 6),
            try shelfProduct("b", "Tanzol Tablet", "Non food", day: 9),
            try shelfProduct("c", "Gari", "Flours & Rice", day: 5),
            try shelfProduct("d", "Yam no photo", "Fresh Produce", day: 4, image: false),
            try shelfProduct("e", "Shea Butter", "Cosmetics", day: 3),
            try shelfProduct("f", "Cocoa Butter", "Cosmetics", day: 2),
            try shelfProduct("g", "Sold out Yam", "Fresh Produce", day: 1, stock: false),
        ]
        let staples = HomeMerchandising.staples(from: shelf)
        check(staples.map(\.id) == ["a"], "Staples need stock and a photo")
        let trending = HomeMerchandising.trending(from: shelf, excluding: Set(staples.map(\.id)))
        check(trending.first?.id == "c" && !trending.contains { $0.id == "a" }, "Trending leads with groceries and skips staples")
        check(trending.filter { $0.category == "Cosmetics" }.count == 1, "Trending caps cosmetics at one")
        // Photos load straight from storage; cards ask the renderer for a resized copy first.
        let photo = URL(string: "https://abc.supabase.co/storage/v1/object/public/product-images/a.jpg?v=7")!
        let photoURLs = StorefrontCatalog.imageURLs(photo, width: 450)
        check(photoURLs.count == 2 && photoURLs.last == photo, "Original photo must stay as the fallback")
        let rendered = photoURLs.first?.absoluteString ?? ""
        check(rendered.contains("/storage/v1/render/image/public/product-images/a.jpg")
              && rendered.contains("v=7") && rendered.contains("width=450"), "Thumbnail must keep the photo version")
        check(StorefrontCatalog.imageURLs(photo, width: nil) == [photo], "Full-size photo must load the original")
        let other = URL(string: "https://kintampoafricanmarket.com/images/categories/spices.jpg")!
        check(StorefrontCatalog.imageURLs(other, width: 450) == [other], "Non-storage photos must pass through")

        // Search matches every word in any order, ignoring case and accents.
        check(CatalogStore.tokens("  Palm, OIL ") == ["palm", "oil"], "Search must split words and commas")
        check(CatalogStore.normalize("Crème Fraîche") == "creme fraiche", "Search must ignore accents")

        // Store hours run on Columbus time: Mon–Sat 9–8, Sun 10–6.
        func storeTime(_ text: String) -> Date {
            let f = ISO8601DateFormatter()
            f.timeZone = TimeZone(identifier: "America/New_York")
            f.formatOptions = [.withFullDate, .withTime, .withColonSeparatorInTime, .withDashSeparatorInDate]
            return f.date(from: text)!
        }
        check(StoreConfig.pickupStatus(at: storeTime("2026-11-04T10:30:00")) == "Open now until 8pm", "Weekday open")
        check(StoreConfig.pickupStatus(at: storeTime("2026-11-04T07:00:00")) == "Opens today at 9am", "Before opening")
        check(StoreConfig.pickupStatus(at: storeTime("2026-11-07T21:00:00")) == "Opens tomorrow at 10am", "Saturday night opens Sunday")
        check(StoreConfig.pickupStatus(at: storeTime("2026-11-08T18:30:00")) == "Opens tomorrow at 9am", "Sunday after close")

        // Carrier links for tracking numbers.
        check(OrderStatusFlow.trackingURL("1Z999AA10123456784")?.host == "www.ups.com", "UPS numbers start with 1Z")
        check(OrderStatusFlow.trackingURL("9400 1000 0000 0000 0000 00")?.host == "tools.usps.com", "USPS by default")
        check(OrderStatusFlow.trackingURL("123456789012")?.host == "www.fedex.com", "12-digit numbers are FedEx")
        check(OrderStatusFlow.trackingURL("  ") == nil, "Blank tracking has no link")

        // Save for later moves a line out of the cart and back.
        let laterCart = CartStore(defaults: defaults)
        laterCart.clear()
        let saver = SavedForLaterStore(defaults: defaults)
        let yam = try product("yam-later", stock: 5)
        laterCart.add(yam, quantity: 2)
        saver.save(laterCart.items[0], from: laterCart)
        check(laterCart.items.isEmpty && saver.products.map(\.id) == ["yam-later"], "Save for later must leave the cart")
        check(SavedForLaterStore(defaults: defaults).products.map(\.id) == ["yam-later"], "Saved items must persist")
        saver.moveToCart(yam, cart: laterCart)
        check(laterCart.quantity(of: "yam-later") == 1 && saver.products.isEmpty, "Move to cart must restore one unit")

        // Store manager: phone display, parcel summary, refund rules.
        check(PhoneFormat.display("+1 614-555-0188") == "(614) 555-0188", "US phone numbers format")
        check(PhoneFormat.display("44 20 7946 0958") == "44 20 7946 0958", "Other numbers stay as typed")
        check(ParcelSize(weightLb: 2.5, lengthIn: 10, widthIn: 8, heightIn: 4).summary == "2.5 lb · 10×8×4 in", "Parcel summary")
        let cardOrder = try decode("""
        {"id":"o1","created_at":"2026-01-01","status":"shipped","total_amount":50,"payment_status":"paid","stripe_payment_intent_id":"pi_1","refund_amount":20,"shipping_label_url":"https://x/l.pdf"}
        """, as: AdminOrder.self)
        check(cardOrder.canRefund && cardOrder.refundableAmount == 30 && cardOrder.hasLabel, "Card order refund rules")
        let cashOrder = try decode("""
        {"id":"o2","created_at":"2026-01-01","status":"ordered","total_amount":22,"payment_status":"unpaid"}
        """, as: AdminOrder.self)
        check(cashOrder.isUnpaid && !cashOrder.canRefund && !cashOrder.hasLabel, "Cash order is settled, not refunded")
        let localOrder = try decode("""
        {"id":"o3","created_at":"2026-01-01","status":"processing","shipping_method":"local_delivery"}
        """, as: AdminOrder.self)
        let mailOrder = try decode("""
        {"id":"o4","created_at":"2026-01-01","status":"processing","shipping_method":"standard"}
        """, as: AdminOrder.self)
        check(!localOrder.needsCarrierLabel && mailOrder.needsCarrierLabel, "Only carrier orders get labels")

        print("PASS: \(checks) mobile regression checks (mock network; no live payments)")
    }
}
