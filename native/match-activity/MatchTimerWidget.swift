import ActivityKit
import Foundation
import SwiftUI
import WidgetKit

@main
struct MatchTimerWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: MatchTimerAttributes.self) { context in
            HStack {
                Label("O‘yin taymeri", systemImage: icon(context.state))
                Spacer()
                timer(context.state)
            }
            .padding()
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Label("O‘yin", systemImage: icon(context.state))
                }
                DynamicIslandExpandedRegion(.trailing) {
                    timer(context.state)
                }
            } compactLeading: {
                Image(systemName: icon(context.state))
            } compactTrailing: {
                timer(context.state)
                    .frame(maxWidth: 50)
            } minimal: {
                Image(systemName: icon(context.state))
            }
        }
    }

    private func icon(_ state: MatchTimerAttributes.ContentState) -> String {
        state.deadline == nil ? "pause.fill" : "play.fill"
    }

    @ViewBuilder
    private func timer(_ state: MatchTimerAttributes.ContentState) -> some View {
        if let deadline = state.deadline {
            Text(timerInterval: min(Date(), deadline)...deadline, countsDown: true)
                .monospacedDigit()
        } else {
            Text(String(format: "%d:%02d", state.remainingSeconds / 60, state.remainingSeconds % 60))
                .monospacedDigit()
        }
    }
}
