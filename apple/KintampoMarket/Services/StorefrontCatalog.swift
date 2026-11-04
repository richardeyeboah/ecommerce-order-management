import Foundation

enum StorefrontCatalog {
    /// Match web `isHiddenFromStorefront` — never show checkout-test SKUs in the app.
    static func isHidden(_ product: Product) -> Bool {
        let name = product.name.lowercased()
        let desc = (product.description ?? "").lowercased()
        if name.contains("payment test")
            || name.contains("checkout test")
            || name.contains("apple pay test")
            || name.hasPrefix("test item")
            || name.contains("($0.60)")
        {
            return true
        }
        if desc.contains("live checkout test"), name.contains("test") { return true }
        return false
    }

    static func visible(_ products: [Product]) -> [Product] {
        products.filter { !isHidden($0) }
    }

    /// Public product page on the live site — never share admin or local URLs.
    static func publicProductURL(id: String) -> URL {
        AppConfig.siteURL.appending(path: "products").appending(path: id)
    }

    /// URLs to try for a product photo, best first.
    ///
    /// The app loads straight from Supabase storage: the website's `/media` proxy exists only
    /// for the browser's CSP and adds a Vercel hop (about 3x slower, never cached). With a
    /// `width`, the first URL is Supabase's resized rendition and the original is the fallback
    /// (the renderer can be unavailable on some plans). The `?v=` version is kept so a replaced
    /// photo is never served from an old cache entry.
    static func imageURLs(_ url: URL, width: Int?) -> [URL] {
        let host = url.host?.lowercased() ?? ""
        let objectMarker = "/storage/v1/object/public/"
        guard host.hasSuffix("supabase.co"),
              let width,
              let range = url.absoluteString.range(of: objectMarker),
              var components = URLComponents(string: url.absoluteString.replacingCharacters(
                in: range, with: "/storage/v1/render/image/public/"
              ))
        else { return [url] }
        var items = components.queryItems ?? []
        items.append(URLQueryItem(name: "width", value: String(width)))
        items.append(URLQueryItem(name: "quality", value: "75"))
        components.queryItems = items
        return [components.url, url].compactMap { $0 }
    }
}
