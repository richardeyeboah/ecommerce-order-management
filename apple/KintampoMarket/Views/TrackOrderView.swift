import SwiftUI

struct TrackOrderView: View {
    @State private var tracker = OrderTrackViewModel()
    @Bindable private var auth = AuthStore.shared

    var body: some View {
        Form {
            if auth.isSignedIn {
                Section {
                    NavigationLink {
                        OrdersView()
                    } label: {
                        Label("Your orders", systemImage: "list.bullet.rectangle")
                            .font(.subheadline.weight(.semibold))
                            .frame(minHeight: 36)
                    }
                } footer: {
                    Text("Orders on your account. For a guest order, look it up below.")
                }
            }
            Section("Order lookup") {
                TextField("Order # (e.g. LQ-1042)", text: $tracker.orderID)
                    #if os(iOS)
                    .textInputAutocapitalization(.characters)
                    #endif
                TextField("Email used at checkout", text: $tracker.email)
                    #if os(iOS)
                    .textInputAutocapitalization(.never)
                    .keyboardType(.emailAddress)
                    #endif
                Button(tracker.isLoading ? "Looking up…" : "Track order") {
                    Task { await tracker.track() }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(tracker.orderID.isEmpty || tracker.email.isEmpty || tracker.isLoading)
                .formButtonRow()
            }

            if let error = tracker.errorMessage {
                Section {
                    Text(error)
                        .foregroundStyle(.red)
                        .font(.caption)
                }
            }

            if let order = tracker.order {
                Section {
                    OrderProgressView(status: order.status, shippingMethod: order.shippingMethod,
                                      trackingNumber: order.trackingNumber)
                }
                Section {
                    LabeledContent("Order", value: order.displayNumber)
                    if let total = order.totalAmount {
                        LabeledContent("Total") {
                            Text(String(format: "$%.2f", total)).foregroundStyle(Brand.ink).fontWeight(.semibold).monospacedDigit()
                        }
                    }
                }
                if !tracker.items.isEmpty {
                    Section("Items") {
                        ForEach(tracker.items) { item in
                            Text("\(item.quantity)× \(item.productName)")
                        }
                        NavigationLink("Order details") {
                            OrderDetailView(order: order, presetItems: tracker.items)
                        }
                    }
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(Brand.surface)
        .navigationTitle("Track")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
    }
}
