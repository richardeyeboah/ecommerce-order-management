import Foundation
#if os(iOS)
import UIKit
#endif
import Observation

@Observable
@MainActor
final class AuthStore {
    static let shared = AuthStore()

    var accessToken: String?
    var userId: String?
    var email: String = ""
    var profile: UserProfile?
    /// Social providers switched on in Supabase ("apple", "google"); empty until loaded.
    var socialProviders: Set<String> = []
    var hasSocialSignIn: Bool { socialProviders.contains("apple") || socialProviders.contains("google") }
    var isSignedIn: Bool { accessToken != nil && !(accessToken?.isEmpty ?? true) }

    private init() {
        // The old build saved only an access token, which cannot renew a session.
        for key in ["lqam-auth-token", "lqam-auth-user", "lqam-auth-email"] {
            UserDefaults.standard.removeObject(forKey: key)
        }
        Task { await hydrate() }
    }

    func validAccessToken() async throws -> String? {
        do {
            guard let session = try await SupabaseService.shared.validSession() else {
                accessToken = nil
                userId = nil
                if profile != nil { email = "" }
                profile = nil
                return nil
            }
            accessToken = session.accessToken
            userId = session.userId
            email = session.email
            return session.accessToken
        } catch {
            if case AppError.unauthorized = error { await signOut() }
            throw error
        }
    }

    func loadSocialProviders() async {
        if let found = try? await SupabaseService.shared.enabledAuthProviders() { socialProviders = found }
    }

    func hydrate() async {
        await loadSocialProviders()
        do {
            _ = try await validAccessToken()
            if let userId { profile = try await SupabaseService.shared.fetchProfile(userID: userId) }
        } catch {
            if case AppError.unauthorized = error { await signOut() }
        }
    }

    func signIn(email: String, password: String) async throws {
        let result = try await SupabaseService.shared.signInWithSession(email: email, password: password)
        await adopt(result)
    }

    /// Apple only shares the name on the very first sign-in; save it if the profile has none.
    func signInWithApple(idToken: String, nonce: String, fullName: String?) async throws {
        let result = try await SupabaseService.shared.signInWithIdToken(provider: "apple", idToken: idToken, nonce: nonce)
        await adopt(result)
        if let fullName, !fullName.isEmpty, (profile?.fullName ?? "").isEmpty {
            try? await updateProfile(fullName: fullName, phone: profile?.phone ?? "")
        }
    }

    func signInWithOAuthCode(_ code: String, verifier: String) async throws {
        let result = try await SupabaseService.shared.exchangeOAuthCode(code, verifier: verifier)
        await adopt(result)
    }

    private func adopt(_ result: AuthSession) async {
        accessToken = result.accessToken
        userId = result.userId
        email = result.email
        profile = try? await SupabaseService.shared.fetchProfile(userID: result.userId)
    }

    func signUp(email: String, password: String, firstName: String, lastName: String, phone: String) async throws {
        try await APIClient.shared.signUp(
            email: email,
            password: password,
            firstName: firstName,
            lastName: lastName,
            phone: phone
        )
        try await signIn(email: email, password: password)
    }

    func signOut() async {
        accessToken = nil
        userId = nil
        email = ""
        profile = nil
        await SupabaseService.shared.signOut()
        await WishlistStore.shared.refresh()
    }

    func updateProfile(fullName: String, phone: String) async throws {
        guard let userId else { throw AppError.unauthorized }
        try await SupabaseService.shared.updateProfile(userID: userId, fullName: fullName, phone: phone)
        profile = try await SupabaseService.shared.fetchProfile(userID: userId)
    }


}

@Observable
@MainActor
final class WishlistStore {
    static let shared = WishlistStore()
    private(set) var productIDs: Set<String> = []
    private(set) var products: [Product] = []
    private(set) var isLoading = false

    private var loadedFor: String?

    func contains(_ id: String) -> Bool { productIDs.contains(id) }

    /// Product pages call this; the list is fetched once per signed-in user, then kept in sync
    /// by `toggle`. Pull to refresh on the Saved screen still forces a reload.
    func refreshIfNeeded() async {
        guard loadedFor != AuthStore.shared.userId else { return }
        await refresh()
    }

    func refresh() async {
        guard AuthStore.shared.isSignedIn else {
            productIDs = []
            products = []
            loadedFor = nil
            return
        }
        isLoading = true
        defer { isLoading = false }
        do {
            let rows = try await SupabaseService.shared.fetchWishlist()
            productIDs = Set(rows.map(\.productId))
            loadedFor = AuthStore.shared.userId
            let ids = Array(productIDs)
            if ids.isEmpty {
                products = []
            } else {
                products = try await SupabaseService.shared.fetchProductsByIDs(ids)
            }
        } catch {
            // keep last known
        }
    }

    /// Optimistic: the heart fills at once and rolls back if the server refuses.
    func toggle(_ product: Product) async {
        guard AuthStore.shared.isSignedIn else { return }
        let removing = contains(product.id)
        let previous = (productIDs, products)
        #if os(iOS)
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        #endif
        if removing {
            productIDs.remove(product.id)
            products.removeAll { $0.id == product.id }
        } else {
            productIDs.insert(product.id)
            if !products.contains(where: { $0.id == product.id }) { products.insert(product, at: 0) }
        }
        do {
            if removing {
                try await SupabaseService.shared.removeFromWishlist(productID: product.id)
            } else {
                try await SupabaseService.shared.addToWishlist(productID: product.id)
            }
        } catch {
            (productIDs, products) = previous
        }
    }
}

@Observable
@MainActor
final class RecentlyViewedStore {
    static let shared = RecentlyViewedStore()
    private let key = "lqam-recently-viewed"
    private let maxCount = 12
    private(set) var products: [Product] = []

    private init() { load() }

    func record(_ product: Product) {
        products.removeAll { $0.id == product.id }
        products.insert(product, at: 0)
        if products.count > maxCount {
            products = Array(products.prefix(maxCount))
        }
        persist()
    }

    private func load() {
        guard let data = UserDefaults.standard.data(forKey: key),
              let decoded = try? JSONDecoder().decode([Product].self, from: data)
        else { return }
        products = decoded
    }

    private func persist() {
        guard let data = try? JSONEncoder().encode(products) else { return }
        UserDefaults.standard.set(data, forKey: key)
    }
}
