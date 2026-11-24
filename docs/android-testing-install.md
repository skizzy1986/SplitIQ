# Installing the SplitIQ Android test build

Each successful Android build on `main` publishes a testing APK to one fixed link (#763):

**https://github.com/skizzy1986/SplitIQ/releases/download/android-latest/splitiq.apk**

- The repo is public, so **this APK is public**. Anyone with the link can download it. It
  is a non-debuggable testing build. It is not a Play Store build.
- It lives on a rolling **prerelease** tagged `android-latest`, titled
  `SplitIQ Android <version>+<build>`. CI swaps the file on every `main` build. It is never
  marked "Latest", so `/releases/latest` still points at the squat-anatomy archive.
- PR builds never land here. They stay as 14-day `splitiq-debug` artifacts on the Actions run.
- It is signed with the SplitIQ **testing** key. Expected certificate SHA-256:
  `8F:F4:FF:CB:6A:33:A1:65:2C:D7:FF:D9:7E:B2:F5:69:47:FE:3F:96:1D:45:6C:68:87:4C:20:06:20:39:D3:35`.
  This key is **not** the Play Store key, and it must never become one.
- `versionCode` is the CI run number, so each build is newer than the last one.
  `versionName` is `<package.json version>+<run number>`.

## One-off setup on the phone

1. **Uninstall the SplitIQ you have now** (one last time). Older builds were signed with
   throwaway debug keys, so they can't update to this one. Your Supabase account data is
   safe. Anything stored only on the phone, such as the language choice or unsynced
   offline sessions, is wiped.
2. **Install Obtainium.** Get the latest APK from
   <https://github.com/ImranR98/Obtainium/releases> (for most phones,
   `app-arm64-v8a-release.apk`), or install it from F-Droid. Allow your browser to install
   unknown apps when Android asks.
3. In Obtainium, tap **Add App**.
4. **App Source URL:** `https://github.com/skizzy1986/SplitIQ`
5. Turn on these options:
   - **Include prereleases:** on
   - **Filter release titles by regular expression:** `^SplitIQ Android`
   - **Use latest asset upload as release date:** on
   - **Use release date as version string:** on (turn **Version detection** off if
     Obtainium asks)

   The tag `android-latest` never changes, so Obtainium spots a new build from the upload
   date, not from the tag.

6. Tap **Add**, then **Install**. Allow Obtainium to install unknown apps when Android asks.

## Updates

After a merge to `main` that touches the app, CI replaces `splitiq.apk`. On its next check,
Obtainium shows an update: tap it to install over the top. Same app, no zip, no GitHub
login. On Android 12 and later, Obtainium can often update in the background because it
installed the app.

Fallback: bookmark the fixed link above. Open it, download, and install over the top.

## Signing secrets (maintainer)

CI reads four repository secrets: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`,
`ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD`. Without them, builds still pass, but they use
a throwaway debug key and nothing is published. Never commit the keystore (`*.jks` and
`*.keystore` are git-ignored). Losing the key means every tester has to uninstall again.
