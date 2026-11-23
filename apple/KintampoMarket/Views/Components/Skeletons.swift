import SwiftUI

// Loading placeholders (skeletons, not spinners). Shared by both apps.

struct SkeletonGrid: View {
    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 12)], spacing: 12) {
            ForEach(0..<6, id: \.self) { _ in
                VStack(alignment: .leading, spacing: 8) {
                    RoundedRectangle(cornerRadius: 10).fill(Color.gray.opacity(0.12)).frame(height: 150)
                    RoundedRectangle(cornerRadius: 4).fill(Color.gray.opacity(0.12)).frame(height: 14)
                    RoundedRectangle(cornerRadius: 4).fill(Color.gray.opacity(0.12)).frame(width: 70, height: 14)
                }
                .brandCard()
                .redacted(reason: .placeholder)
            }
        }
    }
}

/// Placeholder list rows shown while store-manager data loads (skeletons, not spinners).
struct SkeletonRows: View {
    var count = 6
    var showsImage = true

    var body: some View {
        ForEach(0..<count, id: \.self) { _ in
            HStack(spacing: 12) {
                if showsImage {
                    RoundedRectangle(cornerRadius: 8).fill(Color.gray.opacity(0.12)).frame(width: 44, height: 44)
                }
                VStack(alignment: .leading, spacing: 6) {
                    RoundedRectangle(cornerRadius: 4).fill(Color.gray.opacity(0.12)).frame(height: 12)
                    RoundedRectangle(cornerRadius: 4).fill(Color.gray.opacity(0.12)).frame(width: 110, height: 10)
                }
                Spacer(minLength: 24)
                RoundedRectangle(cornerRadius: 4).fill(Color.gray.opacity(0.12)).frame(width: 48, height: 12)
            }
            .padding(.vertical, 4)
            .accessibilityHidden(true)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Loading")
    }
}
