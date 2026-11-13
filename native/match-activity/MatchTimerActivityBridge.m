#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(MatchTimerActivity, NSObject)
RCT_EXTERN_METHOD(show:(NSString *)matchId remainingSeconds:(nonnull NSNumber *)remainingSeconds endTimeMs:(nonnull NSNumber *)endTimeMs)
RCT_EXTERN_METHOD(hide)
@end
