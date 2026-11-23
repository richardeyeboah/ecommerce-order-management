import SwiftUI
@preconcurrency import UserNotifications

/// Kintampo Manager: the staff-only app (orders, shipping labels, refunds, stock, reviews).
/// It shares models, services and the brand with the customer app, but none of the
/// shopping screens, and the customer app contains none of these.
@main
struct KintampoManagerApp: App {
    @Environment(\.scenePhase) private var scenePhase
    @Bindable private var alerts = OrderAlerts.shared
    @Bindable private var admin = AdminStore.shared

    init() {
        UNUserNotificationCenter.current().delegate = OrderAlertsDelegate.shared
    }

    var body: some Scene {
        WindowGroup {
            StoreManagerView()
                .tint(Brand.red)
                // While the app is open and signed in, look for new orders every minute.
                .task(id: scenePhase == .active && admin.isSignedIn) {
                    guard scenePhase == .active, admin.isSignedIn else { return }
                    while !Task.isCancelled {
                        await alerts.check()
                        try? await Task.sleep(for: .seconds(60))
                    }
                }
                .onChange(of: scenePhase) { _, phase in
                    if phase == .background { alerts.scheduleBackgroundCheck() }
                }
                .sheet(item: Binding(
                    get: { alerts.openOrderID.map(OpenOrder.init) },
                    set: { alerts.openOrderID = $0?.id }
                )) { order in
                    NavigationStack {
                        AdminOrderDetailView(orderID: order.id)
                            .toolbar {
                                ToolbarItem(placement: .cancellationAction) {
                                    Button("Done") { alerts.openOrderID = nil }
                                }
                            }
                    }
                    .tint(Brand.red)
                }
        }
        .backgroundTask(.appRefresh(OrderAlerts.backgroundTaskID)) {
            await OrderAlerts.shared.scheduleBackgroundCheck()
            await OrderAlerts.shared.check()
        }
    }
}

/// Wraps an order id so a tapped alert can drive `.sheet(item:)`.
private struct OpenOrder: Identifiable {
    let id: String
}
