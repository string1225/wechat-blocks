# Project Instructions

## Release Workflow

After each completed change in this repository:

1. Run appropriate verification for the change.
2. Commit only the intended files.
3. Push the commit to the current upstream branch.
4. After the push succeeds, republish the WeChat mini game with `npm run wechat:upload`.
5. Generate a fresh QR code with `npm run wechat:preview` and send the QR code image to the user.

If publishing or QR generation fails, report the exact blocker and the command output instead of treating the change as finished.
