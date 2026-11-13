import ActivityKit
import Foundation

@available(iOS 16.2, *)
struct MatchTimerAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        let deadline: Date?
        let remainingSeconds: Int
    }

    let matchId: String
}
