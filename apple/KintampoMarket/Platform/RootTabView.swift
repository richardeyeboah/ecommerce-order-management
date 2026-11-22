import SwiftUI

/// iPhone / iPad / Mac — tab shell mirrors the mobile web bottom nav.
struct RootTabView: View {
    @Bindable private var cart = CartStore.shared
    @Bindable private var router = AppRouter.shared
    @State private var tab = 0
    @State private var shopPath = NavigationPath()
    @AppStorage("didShowWelcome") private var didShowWelcome = false

    var body: some View {
        TabView(selection: $tab) {
            NavigationStack {
                HomeView().testModeBanner()
            }
            .addedToast()
            .tabItem { Label("Home", systemImage: "house.fill") }
            .tag(0)

            NavigationStack(path: $shopPath) {
                ShopView().testModeBanner()
            }
            .addedToast()
            .tabItem { Label("Shop", systemImage: "bag.fill") }
            .tag(1)

            NavigationStack {
                CartView().testModeBanner()
            }
            .tabItem {
                Label("Cart", systemImage: "cart.fill")
            }
            .badge(cart.itemCount > 0 ? cart.itemCount : 0)
            .tag(2)

            NavigationStack {
                TrackOrderView().testModeBanner()
            }
            .addedToast()
            .tabItem { Label("Track", systemImage: "shippingbox.fill") }
            .tag(3)

            NavigationStack {
                AccountView().testModeBanner()
            }
            .addedToast()
            .tabItem { Label("Account", systemImage: "person.fill") }
            .tag(4)
        }
        .tint(Brand.red)
        // Saved carts can outlive products and prices; check them against the live store on launch.
        .task { await cart.refreshFromStore() }
        .onChange(of: router.pendingProductID) { _, id in
            guard let id else { return }
            tab = 1
            shopPath.append(id)
            router.pendingProductID = nil
        }
        #if os(iOS)
        .fullScreenCover(isPresented: Binding(get: { !didShowWelcome }, set: { didShowWelcome = !$0 })) {
            WelcomeView(
                onStart: { didShowWelcome = true; tab = 0 },
                onSignIn: { didShowWelcome = true; tab = 4 }
            )
        }
        #endif
        .onChange(of: router.searchRequest) { _, _ in
            shopPath = NavigationPath()
            tab = 1
        }
        .onChange(of: router.requestedTab) { _, next in
            guard let next else { return }
            tab = next
            router.requestedTab = nil
        }
    }
}

/// Shows `AddedToast` above the tab bar after any add to cart. Lives inside each tab's
/// content (not over the TabView) so it sits above the floating tab bar.
private struct AddedToastHost: ViewModifier {
    @Bindable private var cart = CartStore.shared
    @State private var toast: String?

    func body(content: Content) -> some View {
        content
            .overlay(alignment: .bottom) {
                if let toast {
                    AddedToast(name: toast) {
                        self.toast = nil
                        AppRouter.shared.requestedTab = 2
                    }
                    .padding(.horizontal, 16)
                    .padding(.bottom, 12)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                }
            }
            .onChange(of: cart.lastAdded?.token) { _, _ in
                guard let added = cart.lastAdded else { return }
                withAnimation(.snappy(duration: 0.2)) { toast = added.name }
            }
            .task(id: cart.lastAdded?.token) {
                try? await Task.sleep(for: .seconds(3))
                guard !Task.isCancelled else { return }
                withAnimation(.easeOut(duration: 0.2)) { toast = nil }
            }
    }
}

/// Confirms an add from anywhere in the app, with a shortcut to the cart.
private struct AddedToast: View {
    let name: String
    let onViewCart: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "checkmark.circle.fill").foregroundStyle(Brand.kenteGold)
            VStack(alignment: .leading, spacing: 1) {
                Text("Added to cart").font(.subheadline.weight(.semibold))
                Text(name).font(.caption).opacity(0.85).lineLimit(1)
            }
            Spacer(minLength: 8)
            Button("View cart", action: onViewCart)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Brand.kenteGold)
                .frame(minHeight: 44)
                .accessibilityIdentifier("toastViewCart")
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 14)
        .padding(.vertical, 6)
        .background(Brand.forest, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .shadow(color: .black.opacity(0.2), radius: 10, y: 4)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("addedToast")
        .onAppear {
            AccessibilityNotification.Announcement("Added \(name) to cart").post()
        }
    }
}

private extension View {
    func addedToast() -> some View { modifier(AddedToastHost()) }

    /// Sits under each tab's navigation bar so it never covers the title.
    func testModeBanner() -> some View {
        safeAreaInset(edge: .top, spacing: 0) {
            if AppConfig.fixtureURL != nil {
                Text("TEST MODE — sample products and test payments")
                    .font(.caption).frame(maxWidth: .infinity).padding(6)
                    .background(Color(hex: 0xFBF3C9))
            }
        }
    }
}

#if os(macOS)
/// Mac uses the same tabs; optionally switch to sidebar later.
typealias PlatformRootView = RootTabView
#elseif os(iOS)
typealias PlatformRootView = RootTabView
#endif
