import SwiftUI
import WebKit
#if os(macOS)
import AppKit
#endif

struct StoreWebPage: View {
    let title: String
    let path: String

    var body: some View {
        StoreWebView(url: AppConfig.siteURL.appending(path: path))
            .navigationTitle(title)
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .ignoresSafeArea(edges: .bottom)
    }
}

struct StoreWebView: View {
    let url: URL
    var body: some View {
        #if os(iOS)
        IOSWebView(url: url)
        #elseif os(macOS)
        MacWebView(url: url)
        #else
        Text(url.absoluteString).font(.caption)
        #endif
    }
}

#if os(iOS)
private struct IOSWebView: UIViewRepresentable {
    let url: URL
    func makeUIView(context: Context) -> WKWebView { WKWebView() }
    func updateUIView(_ webView: WKWebView, context: Context) {
        if webView.url != url { webView.load(URLRequest(url: url)) }
    }
}
#endif

#if os(macOS)
private struct MacWebView: NSViewRepresentable {
    let url: URL
    func makeNSView(context: Context) -> WKWebView { WKWebView() }
    func updateNSView(_ webView: WKWebView, context: Context) {
        if webView.url != url { webView.load(URLRequest(url: url)) }
    }
}
#endif

struct ForgotPasswordView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var email = ""
    @State private var message: String?
    @State private var failed = false
    @State private var sending = false

    var body: some View {
        Form {
            Section {
                TextField("Email", text: $email)
                    #if os(iOS)
                    .textInputAutocapitalization(.never)
                    .keyboardType(.emailAddress)
                    .textContentType(.username)
                    .autocorrectionDisabled()
                    #endif
                Button(sending ? "Sending…" : "Email reset link") {
                    Task { await send() }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(sending || !email.contains("@"))
                .formButtonRow()
            } footer: {
                Text("The reset link opens on the website, then you can sign in here with the new password.")
            }
            if let message {
                Section {
                    Text(message).foregroundStyle(failed ? .red : .green).font(.subheadline)
                }
            }
        }
        .navigationTitle("Reset password")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
    }

    private func send() async {
        sending = true
        defer { sending = false }
        do {
            try await APIClient.shared.forgotPassword(email: email.trimmingCharacters(in: .whitespacesAndNewlines))
            failed = false
            message = "If that email has an account, a reset link is on the way."
        } catch {
            failed = true
            message = error.localizedDescription
        }
    }
}

struct ChangePasswordView: View {
    @State private var password = ""
    @State private var confirm = ""
    @State private var message: String?
    @State private var failed = false
    @State private var saving = false

    var body: some View {
        Form {
            SecureField("New password", text: $password)
            SecureField("Confirm password", text: $confirm)
            Button(saving ? "Saving…" : "Update password") {
                Task { await save() }
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(saving || password.count < 8 || password != confirm)
            .formButtonRow()
            if password != confirm, !confirm.isEmpty {
                Text("Passwords do not match.").font(.caption).foregroundStyle(Brand.red)
            }
            if let message {
                Text(message).font(.caption).foregroundStyle(failed ? .red : .green)
            }
        }
        .navigationTitle("Password")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
    }

    private func save() async {
        saving = true
        defer { saving = false }
        do {
            try await SupabaseService.shared.updatePassword(password)
            failed = false
            message = "Password updated."
            password = ""
            confirm = ""
        } catch {
            failed = true
            message = error.localizedDescription
        }
    }
}

struct OrderDetailView: View {
    let order: TrackedOrder
    var presetItems: [OrderLineItem] = []
    @State private var items: [OrderLineItem] = []
    @State private var errorMessage: String?
    @State private var reorderNote: String?

    var body: some View {
        List {
            Section {
                OrderProgressView(status: order.status, shippingMethod: order.shippingMethod,
                                  trackingNumber: order.trackingNumber)
            }
            Section {
                LabeledContent("Order", value: order.displayNumber)
                LabeledContent("Placed", value: OrderStatusStyle.dateLabel(order.createdAt))
                if let total = order.totalAmount {
                    LabeledContent("Total", value: String(format: "$%.2f", total))
                }
            }
            Section("Items") {
                if let errorMessage {
                    Text(errorMessage).foregroundStyle(.red)
                } else if items.isEmpty {
                    Text("No line items on this order.")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(items) { item in
                        HStack(alignment: .firstTextBaseline) {
                            Text("\(item.quantity)×").foregroundStyle(Brand.inkMuted).monospacedDigit()
                            Text(item.productName).foregroundStyle(Brand.ink)
                            Spacer()
                            Text(String(format: "$%.2f", item.productPrice * Double(item.quantity)))
                                .foregroundStyle(Brand.ink)
                                .monospacedDigit()
                        }
                        .font(.subheadline)
                    }
                }
            }
            if !items.isEmpty {
                Section {
                    Button("Buy again") { Task { await reorder() } }
                        .buttonStyle(PrimaryButtonStyle())
                        .formButtonRow()
                    if let reorderNote {
                        Text(reorderNote).font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
        }
        .navigationTitle(order.displayNumber)
        .task { await load() }
    }

    private func load() async {
        if !presetItems.isEmpty {
            items = presetItems
            return
        }
        do {
            items = try await SupabaseService.shared.fetchOrderItems(orderID: order.id)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func reorder() async {
        let ids = items.compactMap(\.productId)
        guard !ids.isEmpty else {
            reorderNote = "These items are not linked to current products."
            return
        }
        do {
            let products = StorefrontCatalog.visible(try await SupabaseService.shared.fetchProductsByIDs(ids))
            let byID = Dictionary(uniqueKeysWithValues: products.map { ($0.id, $0) })
            var added = 0
            for item in items {
                guard let id = item.productId, let product = byID[id], product.effectiveInStock else { continue }
                CartStore.shared.add(product, quantity: item.quantity)
                added += 1
            }
            reorderNote = added == 0 ? "None of these items are in stock." : "Added \(added) item\(added == 1 ? "" : "s") to cart."
        } catch {
            reorderNote = error.localizedDescription
        }
    }
}

/// Order timeline: every step of the pickup or shipping flow, done steps filled in.
struct OrderProgressView: View {
    let status: String
    let shippingMethod: String?
    var trackingNumber: String?

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
                Text(subhead)
                    .font(.subheadline)
                    .foregroundStyle(Brand.inkMuted)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.bottom, 14)
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

struct RecipesView: View {
    @State private var recipes: [RecipeSummary] = []
    @State private var errorMessage: String?

    var body: some View {
        Group {
            if let errorMessage, recipes.isEmpty {
                ContentUnavailableView("Could not load recipes", systemImage: "fork.knife", description: Text(errorMessage))
            } else if recipes.isEmpty {
                ContentUnavailableView("No recipes yet", systemImage: "fork.knife")
            } else {
                List(recipes) { recipe in
                    NavigationLink(value: recipe) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(recipe.title).font(.headline)
                            if let summary = recipe.summary, !summary.isEmpty {
                                Text(summary).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                            }
                        }
                    }
                }
            }
        }
        .navigationTitle("Recipes")
        .navigationDestination(for: RecipeSummary.self) { RecipeDetailView(summary: $0) }
        .task { await load() }
        .refreshable { await load() }
    }

    private func load() async {
        do {
            recipes = try await SupabaseService.shared.fetchRecipes()
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

struct RecipeDetailView: View {
    let summary: RecipeSummary
    @State private var recipe: RecipeSummary
    @State private var lines: [RecipeIngredientLine] = []

    init(summary: RecipeSummary) {
        self.summary = summary
        _recipe = State(initialValue: summary)
    }

    var body: some View {
        List {
            if let imageURL = recipe.imageURL, let url = URL(string: imageURL) {
                CachedProductImage(url: url)
                    .frame(height: 180)
                    .listRowInsets(EdgeInsets())
            }
            if let summary = recipe.summary, !summary.isEmpty {
                Text(summary)
            }
            Section("Ingredients") {
                ForEach(lines) { line in
                    Text("\(formatQty(line.quantity)) \(line.label)")
                }
            }
            if let body = recipe.body, !body.isEmpty {
                Section("Method") {
                    Text(body)
                }
            }
            if lines.contains(where: { $0.productId != nil }) {
                Section {
                    Button("Add linked ingredients to cart") { Task { await addIngredients() } }
                        .buttonStyle(PrimaryButtonStyle())
                        .formButtonRow()
                }
            }
        }
        .navigationTitle(recipe.title)
        .task { await load() }
    }

    private func load() async {
        if let full = try? await SupabaseService.shared.fetchRecipe(slug: summary.slug) {
            recipe = full
        }
        lines = (try? await SupabaseService.shared.fetchRecipeIngredients(recipeID: recipe.id)) ?? []
    }

    private func addIngredients() async {
        let ids = lines.compactMap(\.productId)
        guard let products = try? await SupabaseService.shared.fetchProductsByIDs(ids) else { return }
        let byID = Dictionary(uniqueKeysWithValues: products.map { ($0.id, $0) })
        for line in lines {
            guard let id = line.productId, let product = byID[id], product.effectiveInStock else { continue }
            let qty = max(1, Int(line.quantity.rounded()))
            CartStore.shared.add(product, quantity: qty)
        }
    }

    private func formatQty(_ value: Double) -> String {
        value == value.rounded() ? String(Int(value)) : String(format: "%.1f", value)
    }
}

struct ProductReviewsSection: View {
    let productID: String
    @Bindable private var auth = AuthStore.shared
    @State private var reviews: [ProductReview] = []
    @State private var rating = 5
    @State private var name = ""
    @State private var comment = ""
    @State private var note: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Reviews")
                .font(.headline)
            if reviews.isEmpty {
                Text("No reviews yet.").font(.subheadline).foregroundStyle(.secondary)
            } else {
                ForEach(reviews) { review in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(String(repeating: "★", count: review.rating) + String(repeating: "☆", count: max(0, 5 - review.rating)))
                            .foregroundStyle(Brand.red)
                        Text(review.reviewerName).font(.subheadline.weight(.semibold))
                        if let comment = review.comment, !comment.isEmpty {
                            Text(comment).font(.subheadline)
                        }
                    }
                }
            }
            Stepper("Rating: \(rating)", value: $rating, in: 1...5)
            TextField("Your name", text: $name)
            TextField("Comment", text: $comment, axis: .vertical)
                .lineLimit(2...4)
            Button("Submit review") { Task { await submit() } }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
            if let note {
                Text(note).font(.caption).foregroundStyle(.secondary)
            }
        }
        .task {
            if name.isEmpty { name = auth.profile?.fullName ?? "" }
            reviews = (try? await SupabaseService.shared.fetchReviews(productID: productID)) ?? []
        }
    }

    private func submit() async {
        do {
            try await SupabaseService.shared.submitReview(
                productID: productID,
                name: name.trimmingCharacters(in: .whitespacesAndNewlines),
                rating: rating,
                comment: comment.trimmingCharacters(in: .whitespacesAndNewlines)
            )
            note = "Submitted. It shows on the product after approval."
            comment = ""
        } catch {
            note = error.localizedDescription
        }
    }
}
