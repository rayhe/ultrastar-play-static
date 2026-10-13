# Architecture

## Everything on the client

Cloudflare Pages serves static application files. A song comes from user-selected File/Blob objects or a configured static catalog. There are no application-server routes. Node is only used by the development server, build copier, and tests.

```
File/folder/ZIP -> validated chart + media references -> library
                                          |              |
                                          |         IndexedDB (opt-in)
                                          v
HTMLAudioElement media clock ---> stage / lyrics / note canvas
                                          ^
getUserMedia -> AudioWorklet -> module Worker -> pitch -> scorer
```

Audio is streamed by the HTML media element rather than decoded wholesale into a large AudioBuffer. Background video follows that audio clock with periodic drift correction. All microphone work is local: a capture worklet sends timestamped decimated sample windows, a Worker performs pitch analysis, and the UI receives pitch/energy/confidence results. Work is dropped while the Worker is busy instead of building an unbounded backlog. The main thread draws the canvas and DOM.

## Clock alignment

The worklet timestamps the **center** of each analysis window in AudioContext time. The application maps this back from current media time using elapsed audio-context time, playback rate, and the user timing adjustment. Positive adjustment moves measured events earlier. Pauses, buffering, and backgrounding suspend scoring; fresh windows are required on resume. This is a practical browser clock mapping, not a hardware-loopback measurement of acoustic, OS, or Bluetooth latency.

Browser scheduling jitter or device latency can still lower scores. Timing and real-device calibration remain validation priorities. The pitch detector is designed for a single dominant vocal pitch, roughly 60–1,200 Hz, not polyphonic transcription.

## Trust and data

Chart text is rendered with DOM text nodes, never injected as HTML. Numeric timing, maximum note count, duration, and media matching are validated. ZIP parsing enforces bounds, expansion caps, path rules, and CRC32. These protections reduce common malformed-input risks; they are not a claim of an independent security audit.

Local imports never trigger network fetches of references in their charts. The optional administrator-authored catalog may explicitly contain HTTPS URLs. Its downloads and media requests are the only optional song-network activity. There is no telemetry, analytics library, account endpoint, audio upload, or third-party script in the shipped build.

Cloudflare receives ordinary site requests, and a separately configured media host receives hosted-song requests. This software cannot make promises about those hosts' access logs. The `_headers` file supplies a restrictive CSP, a same-origin microphone policy, no-referrer, and nosniff. Other hosts must apply equivalent HTTP headers themselves.

## Offline and updates

`sw.js` caches a versioned application shell. Local imported media is saved only when the user enables IndexedDB storage; the service worker does not cache arbitrary song audio or network catalog media. First-load online access is required for app caching. A new service worker waits for older controlled pages to close before becoming active; change the cache version for every changed release. Closing all old tabs and reopening is the safe update path.

## Maintaining the code

Pure chart, pitch, scoring, and archive modules are testable without a DOM. UI-specific integration lives in `app.js`. ES modules are shipped unminified to keep inspection straightforward; the build has no package supply chain. A bundler or framework can be added later without changing the static deployment contract.

Priority work before a broad release: physical-device and Safari/Firefox validation; collection-based chart interoperability tests; stereo receiver channel routing; improved clock calibration; a visual note editor; and larger persistent-library indexing. Phone pairing/online multiplayer would need an explicit signaling/transport design, not a hidden server dependency added to this build.
