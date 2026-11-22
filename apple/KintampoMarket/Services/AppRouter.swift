import Foundation
import Observation

/// Opens a public product URL inside the app (`kintampo://` or the live site).
@Observable
@MainActor
final class AppRouter {
    static let shared = AppRouter()
    var pendingProductID: String?
    var selectedTab = 0
    var requestedTab: Int?
    /// Bumped to open Shop at its root with the search field focused (Home's search bar).
    var searchRequest = 0

    func openSearch() {
        searchRequest += 1
    }

    func open(_ url: URL) {
        guard let id = Self.productID(from: url) else { return }
        pendingProductID = id
    }

    static func productID(from url: URL) -> String? {
        let scheme = url.scheme?.lowercased() ?? ""
        if scheme == "kintampo", (url.host ?? "").contains("stripe") { return nil }
        var parts = url.path.split(separator: "/").map(String.init)
        if scheme == "kintampo", let host = url.host, host != "www" {
            parts.insert(host, at: 0)
        }
        guard let index = parts.firstIndex(of: "products"), parts.count > index + 1 else { return nil }
        let id = parts[index + 1]
        return UUID(uuidString: id) == nil ? nil : id
    }
}
