import SwiftUI

struct DashboardView: View {
    @StateObject private var model = DashboardViewModel()

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    privacyBanner

                    if let snapshot = model.snapshot {
                        usageContent(snapshot)
                    } else {
                        emptyState
                    }

                    if let errorMessage = model.errorMessage {
                        Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                            .font(.footnote)
                            .foregroundStyle(.orange)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .accessibilityLabel("Error: \(errorMessage)")
                    }
                }
                .padding()
            }
            .navigationTitle("Claude Usage")
            .refreshable {
                await model.refresh()
            }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    if model.snapshot != nil {
                        Button("Disconnect", role: .destructive) {
                            Task { await model.disconnect() }
                        }
                    }
                }
            }
            .sheet(isPresented: $model.isShowingSignIn) {
                ClaudeLoginSheet(
                    webView: model.authenticationWebView,
                    onCancel: { model.isShowingSignIn = false },
                    onDone: model.completeSignIn
                )
            }
            .task {
                await model.refresh()
            }
        }
    }

    private var privacyBanner: some View {
        Label {
            Text("Sign-in and usage requests stay between this iPhone and Anthropic.")
        } icon: {
            Image(systemName: "lock.shield")
                .foregroundStyle(.orange)
        }
        .font(.footnote)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(.orange.opacity(0.10), in: RoundedRectangle(cornerRadius: 14))
    }

    @ViewBuilder
    private func usageContent(_ snapshot: UsageSnapshot) -> some View {
        VStack(spacing: 14) {
            ForEach(Array(snapshot.windows.enumerated()), id: \.offset) { _, window in
                UsageWindowCard(window: window)
            }

            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Updated \(snapshot.fetchedAt, style: .relative) ago")
                    if let duration = model.lastRefreshDuration {
                        Text("Fetched in \(duration, format: .number.precision(.fractionLength(2))) s")
                    }
                }
                .foregroundStyle(.secondary)
                Spacer()
                Button {
                    Task { await model.refresh() }
                } label: {
                    if model.isRefreshing {
                        ProgressView()
                    } else {
                        Label("Refresh", systemImage: "arrow.clockwise")
                    }
                }
                .disabled(model.isRefreshing)
            }
            .font(.footnote)

            if let duration = model.lastRefreshDuration {
                ShareLink(item: snapshot.experimentReport(refreshDuration: duration)) {
                    Label("Share test observation", systemImage: "square.and.arrow.up")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .accessibilityHint("Shares anonymized app values and refresh duration for EXP-001")
            }
        }
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label("Connect Claude", systemImage: "gauge.with.dots.needle.33percent")
        } description: {
            Text("Sign in on Anthropic's page to compare your five-hour and weekly limits.")
        } actions: {
            Button("Sign in to Claude") {
                model.showSignIn()
            }
            .buttonStyle(.borderedProminent)
            .tint(.orange)
        }
        .frame(minHeight: 360)
    }
}

private struct UsageWindowCard: View {
    let window: UsageWindowSnapshot

    private var tint: Color {
        switch window.normalizedUtilization {
        case 90...: return .red
        case 70...: return .orange
        default: return .green
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                Text(window.title)
                    .font(.headline)
                Spacer()
                Text(window.normalizedUtilization / 100, format: .percent.precision(.fractionLength(0)))
                    .font(.title2.bold())
                    .foregroundStyle(tint)
            }

            ProgressView(value: window.normalizedUtilization, total: 100)
                .tint(tint)

            if let resetsAt = window.resetsAt {
                Text("Resets \(resetsAt, style: .relative)")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            } else {
                Text("Reset time unavailable")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .padding()
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 18))
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(window.title), \(Int(window.normalizedUtilization)) percent used")
    }
}
