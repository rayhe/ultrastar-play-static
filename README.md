# UltraStar Play Static

A browser-native, MIT-licensed karaoke game for **Cloudflare Pages or any HTTPS static host**. Open an UltraStar song folder, connect a microphone, and sing against the chart. Audio analysis, scoring, editing, and optional song storage all run in your browser.

**Release: 0.1.0. This is a working browser reimplementation, not a feature-complete conversion of the Unity application or an official UltraStar Play release.** See [Compatibility](docs/COMPATIBILITY.md) for the exact boundaries and [NOTICE](NOTICE.md) for upstream provenance.

## Run locally

Requires Node.js 20+ (tested with Node 22.16.0). There are no npm dependencies.

```sh
npm ci
npm test
npm run dev
# Open http://localhost:5173
```

Do not open index.html as file://. JavaScript modules, microphone access, and the service worker need a proper HTTP origin; localhost works for development, HTTPS for other devices.

## Build and deploy

```sh
npm run build
npm run preview
```

The output is `dist/`: plain HTML, CSS, JavaScript, icons, documentation, and license files. **No production Node server, Cloudflare Worker, Pages Function, database service, paid API, CDN dependency, or Unity runtime is required.** The included server is only a local development tool.

For Cloudflare Pages Git integration:

| Setting | Value |
| --- | --- |
| Framework preset | None |
| Root directory | Repository root |
| Build command | `npm run check` |
| Build output directory | `dist` |
| Node version | `22` |

Or upload the prebuilt site ZIP with Pages Direct Upload. Keep index.html at the ZIP root. For CLI deployment, extract the ZIP or build first:

```sh
npx wrangler login
npx wrangler pages project create ultrastar-play-static --production-branch main
npx wrangler pages deploy dist --project-name ultrastar-play-static --branch main
```

These commands publish a site using your Cloudflare account. They have not been run for this release. See [Deployment](docs/DEPLOYMENT.md), including the distinction between a Direct Upload project and a Git-integrated project.

## First song

1. Click **Try the warm-up** for the original, procedurally synthesized warm-up, or import an UltraStar `.txt` and matching audio together. Folder and ZIP imports preserve relative filenames; include covers, backgrounds, and video when available.
2. Open **Soundcheck**, connect a microphone, and verify the pitch and level display. Use headphones, not speakers: a guide vocal leaking into your microphone can score as your voice.
3. Click **Sing**, choose a voice/backing track, then **Start singing**. Without a microphone, use **Rehearse · no score**.

The demo's sound is an instrumental pitch guide, not synthesized singing. Its chart and WAV can be exported in **Edit chart**.

## Implemented

- Local files, recursive folders, drag-and-drop, and ZIP32 stored/deflate imports; robust chart/media matching and input validation.
- Search, favorites, a session queue, cover art, song metadata, and optional IndexedDB persistence for imported songs.
- Real microphone input, pitch and level meters, a capture AudioWorklet and separate pitch-analysis Worker; adjustable timing, noise gate, and difficulty.
- Animated pitch targets, measured pitch traces, synchronized highlighted lyrics, background image/video, fullscreen, pause, speed, volume, and rehearsal seeking.
- One or two separate microphone devices; select the same melody or different P1/P2 duet parts. Two physical microphones remain a hardware-validation requirement.
- Independent normalized 10,000-point scoring, golden notes, rap activity scoring, local high scores, and JSON results export. No synthetic/demo scoring.
- Text-based chart editor: validation, GAP nudges, pitch transpose, apply locally, UTF-8 export. Original files are never overwritten.
- Offline application shell and saved local songs after the first successful online load. No auto-download of hosted song media.
- Optional static JSON catalog for a hosted collection; no server-side directory indexing.

## Important limits

This does **not** include the complete Unity UI, native plugins, exact native scoring, the native graphical note editor, auto-transcription, vocal separation, phone microphone pairing, network multiplayer, native database migration, or remote leaderboards. The score system is explicitly `browser-v1`; do not compare it numerically to desktop UltraStar scores.

Browser codec support still applies. ZIPs are deliberately limited to 256 MiB compressed/expanded and 4,000 entries; use folder import for larger video collections. ZIP64, encrypted archives, and non-UTF-8 legacy ZIP filenames are unsupported.

Cloudflare Pages currently limits each hosted asset to 25 MiB. User-selected local files are not uploaded to Pages and do not incur that limit. A large hosted media library should live on an appropriate static media host, with HTTPS/CORS configured as needed.

Only import or publish music, video, and lyrics you have the right to use. The software's MIT license does not license your media.

## Project map

```text
src/song.js               Chart parsing, timing, encoding, lookup
src/library.js            Local files, matching, IndexedDB, static catalog
src/zip.js                Bounded ZIP32 extraction and CRC validation
src/capture-worklet.js    Microphone sampling and timestamped windows
src/pitch-worker.js       Off-main-thread pitch analysis
src/pitch.js              Pitch detector and musical utilities
src/microphone.js         Permission, device, worker, and graph lifecycle
src/scoring.js            Pure browser-v1 scoring engine
src/renderer.js           Canvas pitch targets and measured traces
src/app.js                Library, stage, editor, transport, results
src/demo.js               Original chart and synthesized audio
scripts/                 Zero-dependency build and local server
tests/                  Unit and browser integration tests
```

See [Architecture](docs/ARCHITECTURE.md), [Compatibility](docs/COMPATIBILITY.md), and [Testing](docs/TESTING.md).

## Open source

MIT. The upstream copyright and MIT text are retained in `LICENSE` and `licenses/UltraStar-Play-MIT.txt`. Every shipped JavaScript module is readable source. No upstream artwork or commercial song files are redistributed. The original demo, interface, icons, and new code are included under the project MIT license. This release does not establish an affiliation with the upstream authors.

Sources: [UltraStar Play](https://github.com/UltraStar-Deluxe/Play), [UltraStar format](https://usdx.eu/format/), [Cloudflare Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/), [Pages limits](https://developers.cloudflare.com/pages/platform/limits/), [microphone secure contexts](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia).
