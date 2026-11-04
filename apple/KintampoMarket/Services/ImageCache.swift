import Foundation
import ImageIO
import SwiftUI

#if os(macOS)
import AppKit
typealias PlatformImage = NSImage
#else
import UIKit
typealias PlatformImage = UIImage
#endif

/// How large a photo will be drawn. Cards get a resized thumbnail from Supabase's image
/// renderer; the product page and zoom viewer get the original file.
enum ImageSize: Sendable {
    case thumb, full

    /// Width asked of the Supabase renderer (≈ a 150pt card at 3x). `nil` = original file.
    var renderWidth: Int? { self == .thumb ? 450 : nil }
    /// Longest side kept after decoding, so a 4000px upload never sits in memory at full size.
    var maxPixel: CGFloat { self == .thumb ? 600 : 2048 }
}

/// Product photos: memory cache of decoded bitmaps plus a disk URLCache.
///
/// Decoding and downsampling happen off the main thread (ImageIO), so scrolling a grid never
/// waits on JPEG decoding, and concurrent requests for the same photo share one download.
final class ImageCache: @unchecked Sendable {
    static let shared = ImageCache()

    private let memory = NSCache<NSString, PlatformImage>()
    private let session: URLSession
    private let inflight = InflightLoads()

    private init() {
        memory.countLimit = 300
        memory.totalCostLimit = 80 * 1024 * 1024

        let config = URLSessionConfiguration.default
        config.urlCache = URLCache(
            memoryCapacity: 16 * 1024 * 1024,
            diskCapacity: 200 * 1024 * 1024,
            diskPath: "kintampo-images"
        )
        // Storage answers `no-cache`; photo URLs carry a `?v=` version, so a cached copy is safe.
        config.requestCachePolicy = .returnCacheDataElseLoad
        config.timeoutIntervalForRequest = 15
        config.timeoutIntervalForResource = 30
        config.httpMaximumConnectionsPerHost = 6
        session = URLSession(configuration: config)
    }

    private static func key(_ url: URL, _ size: ImageSize) -> NSString {
        "\(size == .thumb ? "t" : "f")|\(url.absoluteString)" as NSString
    }

    /// Already-decoded image, if any. Lets a view show a photo on its first frame (no flash).
    func cached(_ url: URL, size: ImageSize) -> PlatformImage? {
        memory.object(forKey: Self.key(url, size))
            // A full-size copy also serves a thumbnail request.
            ?? (size == .thumb ? memory.object(forKey: Self.key(url, .full)) : nil)
    }

    func image(for url: URL, size: ImageSize = .thumb) async -> PlatformImage? {
        if let hit = cached(url, size: size) { return hit }
        let key = Self.key(url, size) as String
        return await inflight.run(key) { [self] in
            await self.load(url, size: size, key: key as NSString)
        }
    }

    /// Warms the cache for photos the customer is about to see (shelves, the next screen).
    func prefetch(_ urls: [URL], size: ImageSize = .thumb) {
        for url in urls where cached(url, size: size) == nil {
            Task.detached(priority: .utility) { _ = await self.image(for: url, size: size) }
        }
    }

    private func load(_ url: URL, size: ImageSize, key: NSString) async -> PlatformImage? {
        for candidate in StorefrontCatalog.imageURLs(url, width: size.renderWidth) {
            guard let (data, response) = try? await session.data(from: candidate),
                  let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode),
                  let image = Self.decode(data, maxPixel: size.maxPixel)
            else { continue }
            memory.setObject(image, forKey: key, cost: Self.cost(of: image))
            return image
        }
        return nil
    }

    /// Downsampled, fully decoded bitmap (decoded now instead of at first draw).
    private static func decode(_ data: Data, maxPixel: CGFloat) -> PlatformImage? {
        guard let source = CGImageSourceCreateWithData(data as CFData, [kCGImageSourceShouldCache: false] as CFDictionary)
        else { return nil }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceThumbnailMaxPixelSize: maxPixel,
        ]
        guard let cg = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return nil }
        #if os(macOS)
        return NSImage(cgImage: cg, size: NSSize(width: cg.width, height: cg.height))
        #else
        return UIImage(cgImage: cg)
        #endif
    }

    private static func cost(of image: PlatformImage) -> Int {
        #if os(macOS)
        return Int(image.size.width * image.size.height * 4)
        #else
        guard let cg = image.cgImage else { return 1 }
        return cg.bytesPerRow * cg.height
        #endif
    }
}

/// One download per photo, however many cards ask for it at once.
private actor InflightLoads {
    private var tasks: [String: Task<PlatformImage?, Never>] = [:]

    func run(_ key: String, _ work: @escaping @Sendable () async -> PlatformImage?) async -> PlatformImage? {
        if let existing = tasks[key] { return await existing.value }
        let task = Task { await work() }
        tasks[key] = task
        let result = await task.value
        tasks[key] = nil
        return result
    }
}

struct CachedProductImage: View {
    let url: URL?
    /// `true` shows the whole photo (zoom viewer); the default fills and crops.
    var fit = false
    var background: Color = Brand.surface
    var size: ImageSize = .thumb
    @State private var image: PlatformImage?
    @State private var failed = false

    init(url: URL?, fit: Bool = false, background: Color = Brand.surface, size: ImageSize = .thumb) {
        self.url = url
        self.fit = fit
        self.background = background
        self.size = size
        // Memory hit: draw it on the first frame instead of flashing the placeholder.
        // A full-size request starts from the card's thumbnail while the original downloads.
        _image = State(initialValue: url.flatMap { Self.placeholder($0, size: size) })
    }

    private static func placeholder(_ url: URL, size: ImageSize) -> PlatformImage? {
        ImageCache.shared.cached(url, size: size) ?? (size == .full ? ImageCache.shared.cached(url, size: .thumb) : nil)
    }

    var body: some View {
        ZStack {
            background
            if let image {
                #if os(macOS)
                Image(nsImage: image).resizable().aspectRatio(contentMode: fit ? .fit : .fill)
                #else
                Image(uiImage: image).resizable().aspectRatio(contentMode: fit ? .fit : .fill)
                #endif
            } else if failed || url == nil {
                Image(systemName: "photo")
                    .font(.title3)
                    .foregroundStyle(Brand.inkMuted.opacity(0.35))
            } else {
                Rectangle().fill(Brand.line.opacity(0.45))
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .task(id: url) {
            guard let url else {
                image = nil
                failed = true
                return
            }
            if let hit = ImageCache.shared.cached(url, size: size) {
                image = hit
                return
            }
            image = Self.placeholder(url, size: size)
            failed = false
            let loaded = await ImageCache.shared.image(for: url, size: size)
            guard !Task.isCancelled else { return }
            if let loaded {
                withAnimation(.easeOut(duration: 0.15)) { image = loaded }
            }
            failed = image == nil
        }
    }
}
