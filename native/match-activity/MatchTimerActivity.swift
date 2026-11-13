import ActivityKit
import Foundation

@objc(MatchTimerActivity)
final class MatchTimerActivity: NSObject {
    @objc static func requiresMainQueueSetup() -> Bool { false }

    @objc func show(_ matchId: String, remainingSeconds: NSNumber, endTimeMs: NSNumber) {
        guard #available(iOS 16.2, *) else { return }
        let seconds = remainingSeconds.intValue
        let end = endTimeMs.doubleValue
        Task { @MainActor in
            await MatchTimerActivityStore.shared.show(matchId: matchId, seconds: seconds, end: end)
        }
    }

    @objc func hide() {
        guard #available(iOS 16.2, *) else { return }
        Task { @MainActor in
            await MatchTimerActivityStore.shared.hide()
        }
    }
}

@available(iOS 16.2, *)
@MainActor
private final class MatchTimerActivityStore {
    static let shared = MatchTimerActivityStore()
    private var revision = 0

    func show(matchId: String, seconds: Int, end: Double) async {
        revision += 1
        let request = revision
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        let deadline = end > 0 ? Date(timeIntervalSince1970: end / 1000) : nil
        let state = MatchTimerAttributes.ContentState(deadline: deadline, remainingSeconds: seconds)
        let content = ActivityContent(state: state, staleDate: deadline)
        for activity in Activity<MatchTimerAttributes>.activities where activity.attributes.matchId != matchId {
            await activity.end(nil, dismissalPolicy: .immediate)
        }
        guard request == revision else { return }
        if let activity = Activity<MatchTimerAttributes>.activities.first(where: { $0.attributes.matchId == matchId }) {
            await activity.update(content)
        } else {
            _ = try? Activity.request(attributes: MatchTimerAttributes(matchId: matchId), content: content, pushType: nil)
        }
    }

    func hide() async {
        revision += 1
        for activity in Activity<MatchTimerAttributes>.activities {
            await activity.end(nil, dismissalPolicy: .immediate)
        }
    }
}
