# K9 — Android app

A thin native shell: a full-screen **WebView of the hub's control panel** (`http://<PC IP>:3080`) plus a 6-method bridge (`K9App`) for the phone's microphone and speech. Everything else (joystick, camera, poses, settings, languages) is the panel itself.

```
app/src/main/
├── java/br/k9/vivo/MainActivity.kt   WebView, voice bridge (ouvir, falar, perguntarIA, armarVivo, pararVivo, idioma), error screen
├── res/values/strings.xml            English (default) · values-pt, -es, -fr, -de, -zh = the other languages
├── res/xml/locales_config.xml        per-app language list (Android 13+)
├── res/xml/network_security_config.xml
├── res/drawable, res/mipmap-*        official logo (adaptive icon)
└── AndroidManifest.xml
icone/gerar_icone.py                  regenerates the icon from the official logo
```

## Languages
- The app's own screens (error page, address dialog, toast, Save button) follow the **phone's language** (or the per-app language chosen in Android 13+ settings): Português, English, Español, Français, Deutsch, 中文.
- The panel inside the WebView has its own selector; the app tells the native recogniser and text-to-speech which language to use through `K9App.idioma(tag)` (only the six allowed tags are accepted).
- To add a string, add it to **every** `res/values*/strings.xml`. To add a language, see [`docs/I18N.md`](../../docs/I18N.md).

## Build and install
See [`docs/VIVO.md`](../../docs/VIVO.md#the-k9-android-app-installed-over-usb-the-full-screen-panel-with-a-single-voice-control). Quick version:
```bash
JAVA_HOME=~/Android/jdk17 ANDROID_HOME=~/Android/sdk ./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n br.k9.vivo/.MainActivity -e host <PC IP>
```
`local.properties`, `build/`, `.gradle/` and `*.apk` are git-ignored.
