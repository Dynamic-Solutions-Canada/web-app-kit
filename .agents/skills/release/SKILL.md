---
name: release
description: Releases a new web-app-kit version. Gets the notes approved, bumps the version, tags vX.Y.Z, lets CI create the GitHub Release, then hands the pin bump to each consuming app. Use when asked to release, tag or publish web-app-kit. Do not use for bumping the web-app-kit pin inside an app.
---

Publish the current `main` as a tagged version that apps can pin.

Invoking this skill authorises its own bump commit, tag and push. It still stops twice: for approval of the notes, and on a dirty tree.

1. **Check the tree.** `git status` is clean and `git fetch` shows `HEAD` equal to `origin/main`. Stop and report if not; never commit unrelated work with the release.
2. **Check a release is needed.** Read the changes since the last tag (`git log $(git describe --tags --abbrev=0)..HEAD`; for the first release, the whole history). If only docs, `.agents/`, `.github/` or test files changed, say so and ask whether a release is still wanted: apps receive nothing new from it except the README.
3. **Run the gate.** `npm run validate` and `npm run test:react18` pass. CI on `main` is green for `HEAD` (`gh run list --branch main --limit 5`).
4. **Choose the version.** SemVer for the apps that pin it: a major for anything that needs an edit in a consuming app (a renamed or removed export or prop, a narrowed peer range, a raised Node floor, a behaviour a dialog must now handle), a minor for new behaviour that needs none, a patch for fixes only. While the version is below 1.0.0, a change that needs a consumer edit bumps the minor.
5. **Draft the notes and stop for approval.** Write the proposed `release-notes/<version>.md` content in the reply: bullets only, no heading and no disclosure line, written for the developers of the consuming apps (what changes when they bump the pin, and every edit they must make). Cover every version since the oldest tag any consumer still pins, not only since the last tag. Wait for the maintainer, or the release approver they named, to approve or edit it. Change no files before that.
6. **Bump.** Run `npm version <version> --no-git-tag-version` (it updates `package.json` and `package-lock.json`), write the approved notes file, run `npx prettier --write release-notes`, and commit all three together with the subject `Bump version to v<version>`.
7. **Tag and push.** `git tag -a v<version> -m "web-app-kit <version>"`, then `git push origin main v<version>`.
8. **Watch the Release.** Follow the `Release` workflow for the tag (`gh run watch`). It reruns the gate and the React 18 pass, checks that the tag, version and notes agree, and creates the GitHub Release titled `web-app-kit <version>`. If it fails, report the failing job; do not create or edit the Release by hand.
9. **Hand off the pin bump.** Each consuming app takes the bump as its own change, with the subject `Update web-app-kit: <what it changes for this app>`. An app still on a pinned `allowScripts` key (`github:...#<commit>`) or a registry key (`...web-app-kit@X.Y.Z`) replaces it with the name-only key the README gives, which covers every tag. Do not edit an app repo from this session: hand each app's session the tag, the Release link and the edits the notes list, or list them for the maintainer if no session is open.

Report: the version and why, who approved the notes, the tag, the Release URL and its workflow result, and per consumer what its bump needs.
