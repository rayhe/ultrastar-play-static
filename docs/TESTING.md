# Testing

## Publication validation: October 15, 2026

The recovered release was independently checked on Windows with Node **22.23.3**: `npm ci` and `npm run check` passed, including **80 tests** and the static build. The original release commit is preserved in Git history.

The supplied browser suite passed **12 HTTP integration checks** in headless Chrome **155.0.8059.40**, serving the actual `dist` files over localhost. This exercised normal ES module loading, local TXT/WAV and deflate ZIP imports, editor controls, rehearsal playback and results, mobile layout, and the AudioWorklet/Worker microphone pipeline. Chromium's synthetic A4 input produced a computed score of **10,000**, with no uncaught page errors. This used a fresh test profile and synthetic microphone input, not a physical microphone.

These results do not validate production HTTPS/security headers, real microphones or duets, IndexedDB persistence across sessions, service-worker offline behavior, or Safari/Firefox/mobile hardware. The earlier isolated validation below remains a historical record. See `VALIDATION-2026-10-15.json` for this run.

## Recorded release validation: October 12, 2026

**80 Node tests passed; 0 failed. 11 isolated Chromium UI checks passed; no uncaught page JavaScript errors.** Chromium version 144.0.7559.96; Node 22.16.0.

The managed browser in the build environment blocks all URL navigation and microphone capture. It was not modified or bypassed. For UI validation, the harness rendered the actual HTML/CSS and locally bundled named modules into an about:blank document. Test-only substitutes provided memory localStorage, SHA-256, and an empty catalog response. Actual Blob/WAV media playback worked in that document; the optional fake media-clock fallback was not used.

This checked library rendering, search, favorites, queue controls, text editor changes and validation, TXT/WAV import, deflate ZIP import, stage/canvas/lyrics, real rehearsal media playback, pause/resume, no-score results, mobile overflow, and explicit microphone-unavailable feedback. It did **not** test production-origin ES module loading, real origin storage, service workers, or microphone acquisition. The regular HTTP/fake-microphone integration mode is supplied for a normal development machine but was not executed successfully here.

The Node suite also simulated the exact capture-worklet code on generated PCM at 44.1/48/96 kHz, ran pitch detection on captured windows, verified capture-to-score behavior, and checked microphone cleanup/backpressure using mocks. These are algorithm/contract tests, not real audio-device tests. No Safari, Firefox, iOS, Android, or physical duet validation was performed. See `VALIDATION.json` for the machine-readable record.

## Automated unit tests

```sh
npm test
```

The zero-dependency Node test suite covers chart parsing and encodings; BPM/GAP/version/relative/duet timing; valid and malformed inputs; pitch estimation across generated frequencies and harmonics; silence, noise, and low-energy rejection; score weighting, octaves, tolerances, and duplicate/stale samples; path matching and traversal; ZIP CRC, bounds, stored and deflate extraction; and procedural demo output.

## Browser integration

The optional `tests/browser_smoke.py` uses Python Playwright with Chromium. Python/Playwright are test-only tools, not build or runtime requirements. The test generates original WAV/chart/ZIP fixtures in a temporary directory. It uses Chromium's fake microphone input to exercise the actual capture worklet, worker, and scoring path. A passing test is not evidence that real hardware, Bluetooth, every browser, or an actual duet setup works reliably.

```sh
npm run build
npm run preview
# In another shell, after installing Python Playwright + Chromium:
python tests/browser_smoke.py
# Restricted-browser UI-only harness (not a substitute for the above):
python tests/browser_smoke.py --isolated
```

`CHROMIUM_PATH`, `TEST_BASE_URL`, and `TEST_OUTPUT_DIR` override test defaults. See `VALIDATION.json` for recorded execution results when included with a release.

## Manual validation still required

Test actual singing with headphones, low/high voices, breathy/noisy rooms, input timing adjustment, two distinct USB devices, wireless latency, MP3/video codecs, large collections, long sessions, and browser storage exhaustion. Test Safari/Firefox/mobile independently. Permission denial and changing devices must fail clearly, without inventing a score. Confirm the production HTTPS host's security headers and mic access; local test serving does not prove your hosting setup is correct.
