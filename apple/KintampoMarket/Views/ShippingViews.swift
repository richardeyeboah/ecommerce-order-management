import SwiftUI
#if os(iOS)
import UIKit
#endif

// MARK: - Store manager: shipping, payment and customer actions on an order

/// "Shipping" section of the order screen: buy a label, or reprint and track the one bought.
struct ShippingLabelSection: View {
    let order: AdminOrder
    var onChange: () -> Void

    @State private var printing = false
    @State private var message: String?

    var body: some View {
        Section {
            if order.hasLabel, let tracking = order.trackingNumber, !tracking.isEmpty {
                LabeledContent("Tracking") {
                    Text(tracking).font(.callout.monospaced()).textSelection(.enabled)
                }
                Button {
                    Task { await reprint(share: false) }
                } label: {
                    Label(printing ? "Getting label…" : "Print label", systemImage: "printer")
                }
                .disabled(printing)
                Button {
                    Task { await reprint(share: true) }
                } label: {
                    Label("Share label PDF", systemImage: "square.and.arrow.up")
                }
                .disabled(printing)
                if let url = OrderStatusFlow.trackingURL(tracking) {
                    Link(destination: url) { Label("Track package", systemImage: "shippingbox") }
                }
            } else {
                NavigationLink {
                    BuyLabelView(order: order, onBought: onChange)
                } label: {
                    Label("Buy shipping label", systemImage: "printer.dotmatrix")
                        .font(.body.weight(.semibold))
                        .foregroundStyle(Brand.red)
                }
                .accessibilityIdentifier("buyLabel")
            }
            if let message {
                Text(message).font(.caption).foregroundStyle(Brand.inkMuted)
            }
        } header: {
            Text("Shipping")
        } footer: {
            if !order.hasLabel {
                Text("Buying a label adds tracking, marks the order shipped and emails the customer. To ship another way, type the tracking number under Update.")
            }
        }
    }

    private func reprint(share: Bool) async {
        printing = true
        defer { printing = false }
        do {
            let pdf = try await AdminAPI.shared.labelPDF(orderID: order.id)
            if share {
                LabelPrinter.share(pdf, name: "Label \(order.displayNumber)")
            } else {
                LabelPrinter.present(pdf, name: "Label \(order.displayNumber)")
            }
            message = nil
        } catch AppError.unauthorized {
            AdminStore.shared.sessionExpired()
        } catch {
            message = error.localizedDescription
        }
    }
}

/// Pick a box, see the live USPS price, buy postage, print.
struct BuyLabelView: View {
    let order: AdminOrder
    var onBought: () -> Void

    @State private var parcel = ParcelSize()
    @State private var preset = 1
    @State private var rate: ShippingRate?
    @State private var rateError: String?
    @State private var loadingRate = false
    @State private var buying = false
    @State private var confirmBuy = false
    @State private var bought: ShippingLabelResult?
    @State private var buyError: String?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        Form {
            Section("Ship to") {
                Text(order.customerName ?? "Customer").font(.subheadline.weight(.semibold))
                Text(order.addressSummary.isEmpty ? "No address on this order" : order.addressSummary)
                    .font(.callout)
                    .foregroundStyle(order.addressSummary.isEmpty ? Brand.red : Brand.ink)
            }

            if let bought {
                purchased(bought)
            } else {
                Section {
                    Picker("Box", selection: $preset) {
                        ForEach(Array(ParcelSize.presets.enumerated()), id: \.offset) { index, item in
                            Text(item.name).tag(index)
                        }
                        Text("Custom").tag(-1)
                    }
                    .pickerStyle(.segmented)
                    .listRowInsets(EdgeInsets(top: 8, leading: 12, bottom: 8, trailing: 12))
                    measure("Weight", value: $parcel.weightLb, unit: "lb", range: 0.5...70, step: 0.5)
                    measure("Length", value: $parcel.lengthIn, unit: "in", range: 1...108, step: 1)
                    measure("Width", value: $parcel.widthIn, unit: "in", range: 1...108, step: 1)
                    measure("Height", value: $parcel.heightIn, unit: "in", range: 1...108, step: 1)
                } header: {
                    Text("Package")
                } footer: {
                    Text("Weigh the packed box. Postage is based on weight and size.")
                }

                Section {
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(rate?.description ?? "USPS Ground Advantage").font(.subheadline.weight(.semibold))
                            Text(parcel.summary).font(.caption).foregroundStyle(Brand.inkMuted)
                        }
                        Spacer()
                        if loadingRate {
                            RoundedRectangle(cornerRadius: 4).fill(Brand.line).frame(width: 56, height: 18)
                                .accessibilityLabel("Getting price")
                        } else if let rate {
                            Text(String(format: "$%.2f", rate.price))
                                .font(.headline).monospacedDigit()
                        }
                    }
                    if let rateError {
                        Text(rateError).font(.caption).foregroundStyle(Brand.red)
                    }
                    Button {
                        confirmBuy = true
                    } label: {
                        Text(buying ? "Buying label…" : rate.map { String(format: "Buy label · $%.2f", $0.price) } ?? "Buy label")
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(rate == nil || buying || loadingRate || order.addressSummary.isEmpty)
                    .formButtonRow()
                    .accessibilityIdentifier("confirmBuyLabel")
                    .confirmationDialog(
                        rate.map { String(format: "Buy a USPS label for $%.2f?", $0.price) } ?? "Buy label?",
                        isPresented: $confirmBuy, titleVisibility: .visible
                    ) {
                        Button("Buy label") { Task { await buy() } }
                    } message: {
                        Text("Charged to the store's shipping account. The order is marked shipped and \(order.customerName ?? "the customer") gets the tracking number by email.")
                    }
                    if let buyError {
                        Text(buyError).font(.caption).foregroundStyle(Brand.red)
                    }
                } header: {
                    Text("Postage")
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(Brand.surface)
        .navigationTitle("Ship \(order.displayNumber)")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .onChange(of: preset) { _, index in
            if ParcelSize.presets.indices.contains(index) { parcel = ParcelSize.presets[index].size }
        }
        // Re-quote whenever the box changes (debounced so steppers don't fire a request per tap).
        .task(id: parcel) {
            guard bought == nil else { return }
            try? await Task.sleep(for: .milliseconds(350))
            guard !Task.isCancelled else { return }
            await quote()
        }
    }

    @ViewBuilder
    private func purchased(_ label: ShippingLabelResult) -> some View {
        Section {
            Label("Label bought", systemImage: "checkmark.seal.fill")
                .foregroundStyle(Brand.success)
                .font(.headline)
            LabeledContent("Tracking") {
                Text(label.trackingNumber).font(.callout.monospaced()).textSelection(.enabled)
            }
            if let postage = label.postage {
                LabeledContent("Postage", value: String(format: "$%.2f", postage))
            }
            if label.customerNotified == true {
                Text("The customer was emailed the tracking number.").font(.caption).foregroundStyle(Brand.inkMuted)
            }
            if let pdf = label.pdf {
                Button {
                    LabelPrinter.present(pdf, name: "Label \(order.displayNumber)")
                } label: {
                    Label("Print label", systemImage: "printer")
                }
                .buttonStyle(PrimaryButtonStyle())
                .formButtonRow()
                Button {
                    LabelPrinter.share(pdf, name: "Label \(order.displayNumber)")
                } label: {
                    Label("Share PDF (label printer app, Files)", systemImage: "square.and.arrow.up")
                }
            }
            Button("Done") { dismiss() }
        }
    }

    private func measure(_ title: String, value: Binding<Double>, unit: String,
                         range: ClosedRange<Double>, step: Double) -> some View {
        Stepper(value: Binding(
            get: { value.wrappedValue },
            set: { value.wrappedValue = $0; preset = -1 }
        ), in: range, step: step) {
            LabeledContent(title) {
                Text("\(value.wrappedValue.truncatingRemainder(dividingBy: 1) == 0 ? String(Int(value.wrappedValue)) : String(format: "%.1f", value.wrappedValue)) \(unit)")
                    .monospacedDigit()
            }
        }
    }

    private func quote() async {
        loadingRate = true
        defer { loadingRate = false }
        do {
            rate = try await AdminAPI.shared.shippingRate(orderID: order.id, parcel: parcel)
            rateError = nil
        } catch AppError.unauthorized {
            AdminStore.shared.sessionExpired()
        } catch {
            rate = nil
            rateError = error.localizedDescription
        }
    }

    private func buy() async {
        guard !buying else { return }
        buying = true
        defer { buying = false }
        do {
            let label = try await AdminAPI.shared.buyLabel(orderID: order.id, parcel: parcel)
            bought = label
            buyError = nil
            onBought()
            if let pdf = label.pdf { LabelPrinter.present(pdf, name: "Label \(order.displayNumber)") }
        } catch AppError.unauthorized {
            AdminStore.shared.sessionExpired()
        } catch {
            buyError = error.localizedDescription
        }
    }
}

/// Payment section: settle cash/Zelle orders, refund card orders.
struct OrderPaymentSection: View {
    let order: AdminOrder
    var onChange: () -> Void

    @State private var markMethod: ManualPaymentMethod?
    @State private var working = false
    @State private var message: String?

    var body: some View {
        if order.isUnpaid || order.canRefund || order.isRefunded {
            Section {
                if order.isUnpaid {
                    Menu {
                        ForEach(ManualPaymentMethod.allCases) { method in
                            Button(method.label) { markMethod = method }
                        }
                    } label: {
                        Label("Mark as paid", systemImage: "banknote")
                    }
                    .disabled(working)
                }
                if order.canRefund {
                    NavigationLink {
                        RefundView(order: order, onRefunded: onChange)
                    } label: {
                        Label("Refund", systemImage: "arrow.uturn.backward.circle")
                    }
                }
                if order.isRefunded {
                    LabeledContent("Refunded", value: String(format: "$%.2f", order.refundAmount ?? 0))
                }
                if let message {
                    Text(message).font(.caption).foregroundStyle(Brand.inkMuted)
                }
            } header: {
                Text("Payment")
            }
            .confirmationDialog(
                "Mark \(order.displayNumber) paid by \(markMethod?.label ?? "")?",
                isPresented: Binding(get: { markMethod != nil }, set: { if !$0 { markMethod = nil } }),
                titleVisibility: .visible
            ) {
                Button("Mark paid") {
                    if let method = markMethod { Task { await markPaid(method) } }
                }
            }
        }
    }

    private func markPaid(_ method: ManualPaymentMethod) async {
        working = true
        defer { working = false }
        do {
            try await AdminAPI.shared.markPaid(orderID: order.id, method: method)
            message = "Marked paid (\(method.label))."
            onChange()
        } catch AppError.unauthorized {
            AdminStore.shared.sessionExpired()
        } catch {
            message = error.localizedDescription
        }
    }
}

struct RefundView: View {
    let order: AdminOrder
    var onRefunded: () -> Void

    @State private var amountText = ""
    @State private var reason = ""
    @State private var confirm = false
    @State private var working = false
    @State private var errorMessage: String?
    @Environment(\.dismiss) private var dismiss

    private var amount: Double? {
        Double(amountText.replacingOccurrences(of: "$", with: "").trimmingCharacters(in: .whitespaces))
    }
    private var valid: Bool {
        guard let amount else { return false }
        return amount > 0 && amount <= order.refundableAmount + 0.001
    }

    var body: some View {
        Form {
            Section {
                LabeledContent("Order total", value: String(format: "$%.2f", order.totalAmount ?? 0))
                if (order.refundAmount ?? 0) > 0 {
                    LabeledContent("Already refunded", value: String(format: "$%.2f", order.refundAmount ?? 0))
                }
                HStack {
                    Text("Refund")
                    Spacer()
                    TextField("0.00", text: $amountText)
                        .multilineTextAlignment(.trailing)
                        .monospacedDigit()
                        #if os(iOS)
                        .keyboardType(.decimalPad)
                        #endif
                        .frame(maxWidth: 120)
                }
                Button("Full amount (\(String(format: "$%.2f", order.refundableAmount)))") {
                    amountText = String(format: "%.2f", order.refundableAmount)
                }
                .font(.subheadline)
                TextField("Reason (shown in the order history)", text: $reason, axis: .vertical)
                    .lineLimit(1...3)
            } footer: {
                Text("The money goes back to the customer's card through Stripe. This can't be undone.")
            }
            Section {
                Button(working ? "Refunding…" : "Refund \(amount.map { String(format: "$%.2f", $0) } ?? "")") {
                    confirm = true
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(!valid || working)
                .formButtonRow()
                if let errorMessage {
                    Text(errorMessage).font(.caption).foregroundStyle(Brand.red)
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(Brand.surface)
        .navigationTitle("Refund \(order.displayNumber)")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .onAppear { if amountText.isEmpty { amountText = String(format: "%.2f", order.refundableAmount) } }
        .confirmationDialog(
            "Refund \(amount.map { String(format: "$%.2f", $0) } ?? "") to \(order.customerName ?? "the customer")?",
            isPresented: $confirm, titleVisibility: .visible
        ) {
            Button("Refund", role: .destructive) { Task { await refund() } }
        }
    }

    private func refund() async {
        guard let amount, !working else { return }
        working = true
        defer { working = false }
        do {
            try await AdminAPI.shared.refund(orderID: order.id, amount: amount,
                                             reason: reason.trimmingCharacters(in: .whitespacesAndNewlines))
            onRefunded()
            dismiss()
        } catch AppError.unauthorized {
            AdminStore.shared.sessionExpired()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

/// Label PDFs: AirPrint from the system print sheet, or share to a label-printer app
/// (Rollo, Zebra, Munbyn) or Files. Uses a named file so printers and apps see a real PDF.
enum LabelPrinter {
    static func file(_ pdf: Data, name: String) -> URL? {
        let safe = name.replacingOccurrences(of: " ", with: "-")
        let url = FileManager.default.temporaryDirectory.appending(path: "\(safe).pdf")
        do {
            try pdf.write(to: url, options: .atomic)
            return url
        } catch {
            return nil
        }
    }

    @MainActor
    static func present(_ pdf: Data, name: String) {
        #if os(iOS)
        guard let url = file(pdf, name: name) else { return }
        let info = UIPrintInfo(dictionary: nil)
        info.outputType = .general
        info.jobName = name
        let controller = UIPrintInteractionController.shared
        controller.printInfo = info
        controller.printingItem = url
        controller.present(animated: true)
        #endif
    }

    @MainActor
    static func share(_ pdf: Data, name: String) {
        #if os(iOS)
        guard let url = file(pdf, name: name),
              let root = UIApplication.shared.connectedScenes
                .compactMap({ ($0 as? UIWindowScene)?.keyWindow?.rootViewController }).first
        else { return }
        var top = root
        while let presented = top.presentedViewController { top = presented }
        let sheet = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        sheet.popoverPresentationController?.sourceView = top.view
        top.present(sheet, animated: true)
        #endif
    }
}
