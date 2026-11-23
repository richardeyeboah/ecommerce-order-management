import SwiftUI

/// Kintampo Manager: the staff-only app (orders, shipping labels, refunds, stock, reviews).
/// It shares models, services and the brand with the customer app, but none of the
/// shopping screens, and the customer app contains none of these.
@main
struct KintampoManagerApp: App {
    var body: some Scene {
        WindowGroup {
            NavigationStack {
                StoreManagerView()
            }
            .tint(Brand.red)
        }
    }
}
