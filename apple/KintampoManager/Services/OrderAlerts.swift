import Foundation
import Observation
#if os(iOS)
import BackgroundTasks
#endif
@preconcurrency import UserNotifications

/// New-order alerts without a push server (push needs a paid Apple Developer account).
/// The app checks the newest orders every minute while open, and iOS lets it check now and
/// then in the background (`OrderAlerts.backgroundTaskID`). Each order newer than the last one
/// seen becomes a local notification with sound; tapping it opens the order.
@Observable
@MainActor
final class OrderAlerts {
    static let shared = OrderAlerts()
    nonisolated static let backgroundTaskID = "com.kintampoafricanmarket.manager.orders"

    private let defaults: UserDefaults
    private let enabledKey = "manager.orderAlerts.enabled"
    private let lastSeenKey = "manager.orderAlerts.lastSeen"

    private(set) var enabled: Bool
    /// Shown under the switch when notifications are turned off in Settings.
    private(set) var permissionNote: String?
    /// Set when a notification is tapped; the root view opens this order.
    var openOrderID: String?

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        enabled = defaults.object(forKey: enabledKey) as? Bool ?? false
    }

    func setEnabled(_ on: Bool) async {
        permissionNote = nil
        guard on else {
            enabled = false
            defaults.set(false, forKey: enabledKey)
            updateBadge(0)
            return
        }
        let center = UNUserNotificationCenter.current()
        let granted = (try? await center.requestAuthorization(options: [.alert, .sound, .badge])) ?? false
        guard granted else {
            enabled = false
            defaults.set(false, forKey: enabledKey)
            permissionNote = "Notifications are off for Kintampo Manager. Turn them on in Settings → Notifications."
            return
        }
        enabled = true
        defaults.set(true, forKey: enabledKey)
        // Start from now: don't alert for orders that came in before alerts were switched on.
        defaults.removeObject(forKey: lastSeenKey)
        await check()
        scheduleBackgroundCheck()
    }

    /// Signing out stops alerts for this phone until someone signs in again.
    func reset() {
        defaults.removeObject(forKey: lastSeenKey)
        updateBadge(0)
    }

    /// Fetches the newest orders and notifies for any not seen before. Returns how many were new.
    @discardableResult
    func check() async -> Int {
        guard enabled else { return 0 }
        guard let page = try? await AdminAPI.shared.orders(queue: .all, status: nil, search: "") else { return 0 }
        let fresh = Self.newOrders(page.orders, after: defaults.string(forKey: lastSeenKey))
        if let newest = page.orders.map(\.createdAt).max(by: { Self.date($0) < Self.date($1) }) {
            // First run: remember where we are without alerting for old orders.
            let firstRun = defaults.string(forKey: lastSeenKey) == nil
            defaults.set(newest, forKey: lastSeenKey)
            if firstRun { return 0 }
        }
        for order in fresh.prefix(5) { await notify(order) }
        if fresh.count > 5 { await notifySummary(count: fresh.count) }
        return fresh.count
    }

    /// Orders created after `lastSeen` (ISO timestamps), oldest first.
    nonisolated static func newOrders(_ orders: [AdminOrder], after lastSeen: String?) -> [AdminOrder] {
        guard let lastSeen else { return [] }
        let cutoff = date(lastSeen)
        return orders
            .filter { date($0.createdAt) > cutoff }
            .sorted { date($0.createdAt) < date($1.createdAt) }
    }

    nonisolated static func date(_ iso: String) -> Date {
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = withFraction.date(from: iso) { return d }
        let plain = ISO8601DateFormatter()
        if let d = plain.date(from: iso) { return d }
        // Postgres can send "2026-11-23 10:00:00.123456+00"; normalise to ISO.
        let normalised = iso.replacingOccurrences(of: " ", with: "T")
            .replacingOccurrences(of: #"(\.\d{3})\d+"#, with: "$1", options: .regularExpression)
            .replacingOccurrences(of: #"([+-]\d{2})$"#, with: "$1:00", options: .regularExpression)
        return withFraction.date(from: normalised) ?? plain.date(from: normalised) ?? .distantPast
    }

    func updateBadge(_ count: Int) {
        guard enabled || count == 0 else { return }
        UNUserNotificationCenter.current().setBadgeCount(max(0, count))
    }

    private func notify(_ order: AdminOrder) async {
        let content = UNMutableNotificationContent()
        content.title = order.orderNumber.map { "New order #\($0)" } ?? "New order"
        let total = order.totalAmount.map { $0.formatted(.currency(code: "USD")) }
        let method = OrderStatusFlow.isPickup(order.shippingMethod) ? "Pickup" : "Shipping"
        content.body = [order.customerName, total, method].compactMap { $0 }.joined(separator: " · ")
        content.sound = .default
        content.userInfo = ["orderID": order.id]
        content.threadIdentifier = "new-orders"
        let request = UNNotificationRequest(identifier: "order-\(order.id)", content: content, trigger: nil)
        try? await UNUserNotificationCenter.current().add(request)
    }

    private func notifySummary(count: Int) async {
        let content = UNMutableNotificationContent()
        content.title = "\(count) new orders"
        content.body = "Open Kintampo Manager to see them."
        content.sound = .default
        content.threadIdentifier = "new-orders"
        try? await UNUserNotificationCenter.current().add(
            UNNotificationRequest(identifier: "orders-summary", content: content, trigger: nil)
        )
    }

    /// Asks iOS to wake the app for a check. iOS decides when (usually 15+ minutes).
    func scheduleBackgroundCheck() {
        #if os(iOS)
        guard enabled else { return }
        let request = BGAppRefreshTaskRequest(identifier: Self.backgroundTaskID)
        request.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60)
        try? BGTaskScheduler.shared.submit(request)
        #endif
    }
}

/// Shows alerts as banners while the app is open, and opens the order when one is tapped.
final class OrderAlertsDelegate: NSObject, UNUserNotificationCenterDelegate {
    static let shared = OrderAlertsDelegate()

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        [.banner, .sound, .list]
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        guard let id = response.notification.request.content.userInfo["orderID"] as? String else { return }
        await MainActor.run { OrderAlerts.shared.openOrderID = id }
    }
}
