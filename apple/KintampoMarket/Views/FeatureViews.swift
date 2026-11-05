import SwiftUI
import WebKit
#if os(macOS)
import AppKit
#endif

// MARK: - Checkout

struct CheckoutView: View {
    @Bindable private var cart = CartStore.shared
    @Bindable private var auth = AuthStore.shared
    @Environment(\.dismiss) private var dismiss

    @State private var name = ""
    @State private var email = ""
    @State private var phone = ""
    @State private var address1 = ""
    @State private var address2 = ""
    @State private var city = "Columbus"
    @State private var state = "OH"
    @State private var postalCode = ""
    @State private var shipping: ShippingMethodOption = .pickup
    @State private var pickupSlot: PickupSlotOption = .today_asap
    @State private var pickupName = ""
    @State private var substitution: SubstitutionOption = .refund
    @State private var tip: Double = 0
    @State private var isSubmitting = false
    @State private var errorMessage: String?
    @State private var payment: PaymentIntentResult?
    @State private var showPaySheet = false
    @State private var orderDoneMessage: String?
    @AppStorage("kintampo-pending-payment") private var pendingPaymentID = ""
    @AppStorage("kintampo-pending-cart") private var pendingCart = Data()
    @State private var savedAddresses: [SavedAddress] = []

    private var trimmedEmail: String { email.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var emailValid: Bool {
        let parts = trimmedEmail.split(separator: "@")
        return parts.count == 2 && parts[1].contains(".") && !trimmedEmail.contains(" ")
    }
    private var phoneDigits: String { phone.filter(\.isNumber) }
    private var addressValid: Bool {
        shipping == .pickup ||
            (!address1.trimmingCharacters(in: .whitespaces).isEmpty
                && !city.trimmingCharacters(in: .whitespaces).isEmpty
                && !state.trimmingCharacters(in: .whitespaces).isEmpty
                && postalCode.filter(\.isNumber).count == 5)
    }
    private var validationMessage: String? {
        if name.trimmingCharacters(in: .whitespaces).count < 2 { return "Enter your full name." }
        if !emailValid { return "Enter a valid email for your receipt." }
        if phoneDigits.count < 10 { return "Enter a 10-digit phone number." }
        if shipping == .local_delivery, cart.subtotal < 25 { return "Local delivery needs a $25 minimum." }
        if !addressValid { return "Complete the shipping address (5-digit ZIP)." }
        return nil
    }
    private var canSubmit: Bool { validationMessage == nil && !cart.items.isEmpty }

    var body: some View {
        Form {
            if let orderDoneMessage {
                Section {
                    HStack(spacing: 10) {
                        Image(systemName: "checkmark.circle.fill").foregroundStyle(Brand.success).font(.title2)
                        Text(orderDoneMessage).font(.headline)
                    }
                    Text("A receipt was emailed to \(trimmedEmail). Track it anytime from Account → Orders.")
                        .font(.caption)
                        .foregroundStyle(Brand.inkMuted)
                    Button("Done") { dismiss() }
                        .buttonStyle(PrimaryButtonStyle())
                        .listRowInsets(EdgeInsets())
                }
            } else {
                Section("Contact") {
                    TextField("Full name", text: $name)
                        #if os(iOS)
                        .textContentType(.name)
                        .textInputAutocapitalization(.words)
                        #endif
                    TextField("Email", text: $email)
                        #if os(iOS)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.emailAddress)
                        .textContentType(.emailAddress)
                        .autocorrectionDisabled()
                        #endif
                    TextField("Phone", text: $phone)
                        #if os(iOS)
                        .keyboardType(.phonePad)
                        .textContentType(.telephoneNumber)
                        #endif
                }

                Section("Fulfillment") {
                    Picker("Method", selection: $shipping) {
                        ForEach(ShippingMethodOption.allCases) { method in
                            Text("\(method.label) · \(method.hint)").tag(method)
                        }
                    }
                    if shipping == .pickup {
                        Picker("Pickup window", selection: $pickupSlot) {
                            ForEach(PickupSlotOption.allCases) { slot in
                                Text(slot.label).tag(slot)
                            }
                        }
                        TextField("Who is picking up?", text: $pickupName)
                            #if os(iOS)
                            .textContentType(.name)
                            #endif
                        Label(StoreConfig.address, systemImage: "mappin.and.ellipse")
                            .font(.caption).foregroundStyle(Brand.inkMuted)
                    } else {
                        if savedAddresses.count > 1 {
                            Menu {
                                ForEach(savedAddresses) { a in
                                    Button(a.label ?? a.oneLine) { applyAddress(a, force: true) }
                                }
                            } label: {
                                Label("Use a saved address", systemImage: "book.closed")
                            }
                        }
                        TextField("Address line 1", text: $address1)
                            #if os(iOS)
                            .textContentType(.streetAddressLine1)
                            #endif
                        TextField("Apt / suite", text: $address2)
                            #if os(iOS)
                            .textContentType(.streetAddressLine2)
                            #endif
                        TextField("City", text: $city)
                            #if os(iOS)
                            .textContentType(.addressCity)
                            #endif
                        TextField("State", text: $state)
                            #if os(iOS)
                            .textContentType(.addressState)
                            .textInputAutocapitalization(.characters)
                            #endif
                        TextField("ZIP", text: $postalCode)
                            #if os(iOS)
                            .keyboardType(.numberPad)
                            .textContentType(.postalCode)
                            #endif
                    }
                }

                Section("If an item is out") {
                    Picker("Preference", selection: $substitution) {
                        ForEach(SubstitutionOption.allCases) { opt in
                            Text(opt.label).tag(opt)
                        }
                    }
                }

                if shipping == .local_delivery {
                    Section("Driver tip") {
                        Picker("Tip", selection: $tip) {
                            Text("$0").tag(0.0)
                            Text("$2").tag(2.0)
                            Text("$3").tag(3.0)
                            Text("$5").tag(5.0)
                        }
                        .pickerStyle(.segmented)
                    }
                }

                Section("Order") {
                    ForEach(cart.items) { item in
                        HStack {
                            Text("\(item.quantity)× \(item.product.name)")
                                .lineLimit(1)
                            Spacer()
                            Text(String(format: "$%.2f", item.lineTotal)).monospacedDigit()
                        }
                        .font(.subheadline)
                    }
                    LabeledContent("Subtotal") {
                        Text(String(format: "$%.2f", cart.subtotal)).fontWeight(.semibold).monospacedDigit()
                    }
                    Text(shipping == .pickup ? "Tax is added on the payment screen. Pickup has no shipping fee." : "Tax and shipping are added on the payment screen.")
                        .font(.caption).foregroundStyle(Brand.inkMuted)
                }

                if let errorMessage {
                    Section {
                        Label(errorMessage, systemImage: "exclamationmark.circle.fill")
                            .foregroundStyle(Brand.red).font(.caption)
                    }
                } else if let validationMessage, hasInteracted {
                    Section {
                        Text(validationMessage).foregroundStyle(Brand.inkMuted).font(.caption)
                    }
                }

                Section {
                    Button {
                        hasInteracted = true
                        guard canSubmit else { return }
                        Task { await startPayment() }
                    } label: {
                        HStack {
                            if isSubmitting { ProgressView().tint(.white) }
                            Text(isSubmitting ? "Please wait…" : (pendingPaymentID.isEmpty ? "Continue to payment" : "Check previous payment"))
                        }
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(isSubmitting || cart.items.isEmpty)
                    .formButtonRow()
                    Label("Card payment, encrypted by Stripe.", systemImage: "lock.fill")
                        .font(.caption).foregroundStyle(Brand.inkMuted)
                        .listRowBackground(Color.clear)
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(Brand.surface)
        .navigationTitle("Checkout")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .onAppear {
            if email.isEmpty { email = auth.email }
            if name.isEmpty { name = auth.profile?.fullName ?? "" }
            if phone.isEmpty { phone = auth.profile?.phone ?? "" }
            if pickupName.isEmpty { pickupName = name }
        }
        .sheet(isPresented: $showPaySheet) {
            if let payment {
                NavigationStack {
                    Group {
                    #if os(iOS)
                    NativePaymentView(payment: payment) { message in
                        completeOrder(message)
                    }
                    #else
                    StripePayView(
                        publishableKey: payment.publishableKey ?? AppConfig.stripePublishableKey,
                        clientSecret: payment.clientSecret,
                        paymentIntentId: payment.paymentIntentId
                            ?? String(payment.clientSecret.split(separator: "_").prefix(2).joined(separator: "_")),
                        total: payment.total
                    ) { successMessage in
                        completeOrder(successMessage)
                    }
                    #endif
                    }
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button("Cancel") { showPaySheet = false }
                        }
                    }
                }
            }
        }
        .task {
            if auth.isSignedIn, let addresses = try? await SupabaseService.shared.fetchAddresses() {
                savedAddresses = addresses
                if let preferred = addresses.first(where: \.isDefault) ?? addresses.first {
                    applyAddress(preferred)
                }
            }
        }
    }

    @State private var hasInteracted = false

    private func applyAddress(_ a: SavedAddress, force: Bool = false) {
        if name.isEmpty { name = a.fullName }
        if phone.isEmpty { phone = a.phone ?? "" }
        guard force || address1.isEmpty else { return }
        address1 = a.line1
        address2 = a.line2 ?? ""
        city = a.city
        state = a.state
        postalCode = a.postalCode
    }

    private func completeOrder(_ message: String) {
        pendingPaymentID = ""
        if let purchased = try? JSONDecoder().decode([CartItem].self, from: pendingCart) {
            cart.removePurchased(purchased)
        }
        pendingCart = Data()
        showPaySheet = false
        orderDoneMessage = message
    }

    private func startPayment() async {
        errorMessage = nil
        isSubmitting = true
        defer { isSubmitting = false }
        do {
            let token = try await auth.validAccessToken()
            if !pendingPaymentID.isEmpty {
                let previous = try await APIClient.shared.checkoutStatus(paymentIntentId: pendingPaymentID, accessToken: token)
                if let confirmation = previous.confirmationMessage {
                    completeOrder(confirmation)
                    return
                }
                guard previous.canStartNewPayment else {
                    errorMessage = "Your previous payment is still unresolved. Check again before paying. Your cart is saved."
                    return
                }
                pendingPaymentID = ""
            }
            let checkoutItems = cart.items
            let result = try await APIClient.shared.createPaymentIntent(
                name: name.trimmingCharacters(in: .whitespaces),
                email: trimmedEmail,
                phone: phone.trimmingCharacters(in: .whitespaces),
                address1: address1,
                address2: address2,
                city: city,
                state: state,
                postalCode: postalCode,
                country: "United States",
                items: checkoutItems,
                shippingMethod: shipping.rawValue,
                pickupName: shipping == .pickup ? (pickupName.isEmpty ? name : pickupName) : nil,
                substitutionPref: substitution.rawValue,
                pickupSlot: shipping == .pickup ? pickupSlot.rawValue : nil,
                tipAmount: tip,
                accessToken: token
            )
            payment = result
            pendingCart = try JSONEncoder().encode(checkoutItems)
            pendingPaymentID = result.intentID
            showPaySheet = true
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

// MARK: - Stripe Payment Element (WKWebView)

#if os(iOS) || os(macOS)
struct StripePayView: View {
    let publishableKey: String
    let clientSecret: String
    let paymentIntentId: String
    let total: Double
    var onComplete: (String) -> Void

    @State private var statusText = "Loading secure card form…"
    @State private var isConfirming = false

    var body: some View {
        VStack(spacing: 0) {
            Text(String(format: "Pay $%.2f", total))
                .font(.headline)
                .padding()
            StripeWebView(
                html: stripeHTML(publishableKey: publishableKey, clientSecret: clientSecret),
                onEvent: handleEvent
            )
            Button(isConfirming ? "Checking…" : "Check order status") {
                Task { await pollStatus() }
            }.disabled(isConfirming)
            Text(statusText)
                .font(.caption)
                .foregroundStyle(.secondary)
                .padding()
        }
        .navigationTitle("Payment")
    }

    private func handleEvent(_ name: String, _ payload: String) {
        switch name {
        case "ready":
            statusText = "Enter card details"
        case "error":
            statusText = payload
        case "success":
            statusText = "Confirming order…"
            Task { await pollStatus() }
        default:
            break
        }
    }

    private func pollStatus() async {
        guard !isConfirming else { return }
        isConfirming = true
        defer { isConfirming = false }
        for _ in 0..<20 {
            guard !Task.isCancelled else { return }
            do {
                let result = try await APIClient.shared.checkoutStatus(
                    paymentIntentId: paymentIntentId.isEmpty
                        ? extractPaymentIntentId(from: clientSecret)
                        : paymentIntentId,
                    accessToken: try await AuthStore.shared.validAccessToken()
                )
                if let confirmation = result.confirmationMessage {
                    onComplete(confirmation)
                    return
                }
                if result.status == "unpaid" {
                    statusText = "Payment not finished yet"
                    return
                }
            } catch {
                statusText = error.localizedDescription
            }
            try? await Task.sleep(nanoseconds: 1_000_000_000)
        }
        statusText = "Order confirmation is still pending. Your cart is saved. Check again before paying."

    }

    private func extractPaymentIntentId(from secret: String) -> String {
        // pi_xxx_secret_yyy
        let parts = secret.split(separator: "_")
        if parts.count >= 2 { return "\(parts[0])_\(parts[1])" }
        return secret
    }
}

private func stripeHTML(publishableKey: String, clientSecret: String) -> String {
    """
    <!DOCTYPE html><html><head>
    <meta name="viewport" content="width=device-width, initial-scale=1"/>
    <script src="https://js.stripe.com/v3/"></script>
    <style>
      body{font-family:-apple-system,sans-serif;margin:16px;background:#fafaf9;color:#1c1917}
      #payment-element{margin:12px 0;padding:12px;background:#fff;border-radius:10px}
      button{width:100%;padding:14px;background:#CE1126;color:#fff;border:0;border-radius:10px;font-size:16px;font-weight:600}
      button:disabled{opacity:.5}
      #msg{color:#b91c1c;font-size:13px;min-height:18px}
    </style></head><body>
    <div id="payment-element"></div>
    <p id="msg"></p>
    <button id="pay">Pay now</button>
    <script>
      const stripe = Stripe('\(publishableKey)');
      const elements = stripe.elements({ clientSecret: '\(clientSecret)' });
      const paymentElement = elements.create('payment');
      paymentElement.mount('#payment-element');
      paymentElement.on('ready', () => window.webkit.messageHandlers.kintampo.postMessage({name:'ready',payload:''}));
      document.getElementById('pay').onclick = async () => {
        document.getElementById('pay').disabled = true;
        const {error} = await stripe.confirmPayment({
          elements,
          redirect: 'if_required'
        });
        if (error) {
          document.getElementById('msg').textContent = error.message || 'Payment failed';
          document.getElementById('pay').disabled = false;
          window.webkit.messageHandlers.kintampo.postMessage({name:'error',payload:error.message||'Payment failed'});
        } else {
          window.webkit.messageHandlers.kintampo.postMessage({name:'success',payload:''});
        }
      };
    </script></body></html>
    """
}

#if os(iOS)
struct StripeWebView: UIViewRepresentable {
    let html: String
    var onEvent: (String, String) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onEvent: onEvent) }

    func makeUIView(context: Context) -> WKWebView {
        let content = WKUserContentController()
        content.add(context.coordinator, name: "kintampo")
        let config = WKWebViewConfiguration()
        config.userContentController = content
        let web = WKWebView(frame: .zero, configuration: config)
        web.loadHTMLString(html, baseURL: URL(string: "https://kintampoafricanmarket.com"))
        return web
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKScriptMessageHandler {
        let onEvent: (String, String) -> Void
        init(onEvent: @escaping (String, String) -> Void) { self.onEvent = onEvent }
        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard let body = message.body as? [String: Any],
                  let name = body["name"] as? String else { return }
            let payload = body["payload"] as? String ?? ""
            DispatchQueue.main.async { self.onEvent(name, payload) }
        }
    }
}
#elseif os(macOS)
struct StripeWebView: NSViewRepresentable {
    let html: String
    var onEvent: (String, String) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onEvent: onEvent) }

    func makeNSView(context: Context) -> WKWebView {
        let content = WKUserContentController()
        content.add(context.coordinator, name: "kintampo")
        let config = WKWebViewConfiguration()
        config.userContentController = content
        let web = WKWebView(frame: .zero, configuration: config)
        web.loadHTMLString(html, baseURL: URL(string: "https://kintampoafricanmarket.com"))
        return web
    }

    func updateNSView(_ nsView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKScriptMessageHandler {
        let onEvent: (String, String) -> Void
        init(onEvent: @escaping (String, String) -> Void) { self.onEvent = onEvent }
        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard let body = message.body as? [String: Any],
                  let name = body["name"] as? String else { return }
            let payload = body["payload"] as? String ?? ""
            DispatchQueue.main.async { self.onEvent(name, payload) }
        }
    }
}
#endif
#endif

