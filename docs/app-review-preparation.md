# AMATORA Admin — App Review preparation

## Privacy policy draft

AMATORA Admin is provided to football tournament organizers and their authorized staff under agreements with participating organizations. Organization access is limited to authorized accounts.

We process account email, name, role, organization membership and sign-in information to authenticate administrators, enforce access permissions and maintain security. The app processes team, player, fixture, match and replay data on behalf of participating organizations. Uploaded photos and videos are stored for the requested organization workflows. Selected replay clips and related match data may be sent to our video rendering provider to produce highlights.

Deleting an administrator's account affects their sign-in and access. If the administrator is the sole organization owner, we coordinate transfer of ownership so that staff can continue managing fixtures, matches and team records. Account deletion and removal of the account's associated personal data are handled separately from organization records that must be maintained. Contact gcccc406@gmail.com with privacy or account questions. Never send passwords or sign-in codes by email.

Before publishing: confirm the production providers, whether historic sign-in location remains stored and its retention, actual account deletion and confirmation steps, and the legal basis and duration for any retained personal data. Keep the App Store privacy disclosures aligned with the shipped build.

## Physical-device recording checklist

Use the submitted TestFlight build on a physical iPhone running the latest iOS. Start recording on the Home Screen, open AMATORA Admin, and sign into Amatora Test. Use dedicated demo fixtures and avoid exposing credentials or personal data in the video.

1. Open the dashboard, competition, teams and players. Show a sample fixture and the admin actions the demo role can perform.
2. Open Match Control. Start the demo match, record a score or event, pause, resume and finish. After Live Activities ship, show the remaining time and running/paused state on the Dynamic Island and Lock Screen.
3. Open the finished match, play a replay and show highlight creation or export where available.
4. If the build supports account creation or deletion, demonstrate the actual flow with a disposable account. Include reporting, blocking or paid features if applicable.
5. Review the recording and verify the demo sign-in again. Add the recording or its accessible link and complete review notes to App Review Information before resubmission.

## Review Notes draft

AMATORA Admin helps football tournament organizers maintain teams, players and fixtures, record live scores and match events, and review replays and highlights. Use the credentials in the Sign-In Information section to open the Amatora Test organization. From the organization dashboard, open a fixture and choose Match Control. After reviewing the match controls, open a finished match to review its replay and available highlights.

Before resubmission, add the physical-device recording link, exact menu labels confirmed on the submitted build, external providers and what they do, region differences or confirmed consistent functionality, and documentation for protected material if applicable.

## Live timer device checks

- On a compatible iPhone, allow Live Activities and start a test match in Match Control. Return to the Home Screen and lock the device. Confirm the countdown and play icon. Reopen Match Control, pause and verify the fixed remaining time and pause icon, then resume and finish. Check that leaving Match Control clears the activity.
- On Android, grant notifications when prompted. Verify countdown, pause, resume and cleanup in the notification shade. On a device that supports promoted ongoing notifications, also verify the system chip. Denying notifications must leave Match Control usable.
- The system renders the countdown locally. Cross-device updates while the app is suspended still require server push integration. Verify resynchronization when returning to the app.
- The iOS app extension uses com.amatora.admin.matchtimer. Configure its provisioning profile before creating the signed TestFlight build. Recheck the final binary on a physical device before recording the review demo.
