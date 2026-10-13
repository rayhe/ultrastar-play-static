# Compatibility: v0.1.0

This is a defined browser subset, not the complete Unity application.

## Chart support

| Feature | Behavior |
| --- | --- |
| `TITLE`, `ARTIST`, `BPM` | Required; decimal point or decimal comma BPM; invalid/missing values rejected |
| Timing | `seconds = GAP / 1000 + tick * 15 / TXT_BPM` at constant tempo |
| `GAP` / `AUDIOGAP` | Milliseconds |
| `AUDIO` / `MP3` | Imported audio filename relative to the chart |
| `INSTRUMENTAL` / `INSTRUMENTALAUDIO` | Selectable provided instrumental file; no source separation |
| `COVER`, `BACKGROUND`, `VIDEO` | Imported media references; browser-supported codecs only |
| `START`, `VIDEOGAP` | Seconds in legacy files; milliseconds in declared version 2.x |
| `END` | Milliseconds, including legacy files |
| `P1`, `P2`, `DUETSINGERP1`, `DUETSINGERP2` | Named voice sections; P1 and P2 parts can be assigned independently |
| `:`, `*`, `F`, `R`, `G` | Normal, golden, freestyle, rap, golden rap |
| Lyric spaces and `~` | Syllable spacing retained; continuation marker removed for display |
| `RELATIVE:YES/TRUE` | Upstream-compatible previous-event-relative accumulation; note starts update the reference; phrase-break values share the previous reference |
| `B beat bpm` | Absolute-timing tempo changes as an extension; not combined with RELATIVE |
| Encoding | UTF-8, UTF-8/UTF-16 BOM; declared browser TextDecoder encodings; invalid UTF-8 falls back to Windows-1252 |
| Unknown headers | Retained in text; not silently treated as implemented features |
| Missing terminal `E` | Accepted with a warning |
| Future major versions >2, P3+, overlapping same-voice notes | Rejected explicitly |
| MEDLEY headers, VOCALS, native preview features | Not used for gameplay; warnings where detected |
| AUDIOURL, COVERURL, remote references inside local charts | Not fetched. Configure a trusted static catalog instead |

A chart's pitch 0 corresponds to MIDI 60 (C4). Singing another octave is accepted by default; disable octave flexibility to require the written octave.

The tested relative behavior follows the inspected UltraStar Play parser, not a promise that every other UltraStar implementation interprets every relative chart identically. Tempo-change records are a browser extension. Run your actual collection through import/validation before relying on it for an event.

## Scoring contract

The independent `browser-v1` score is:

`10,000 * correctly sung weighted duration / total scorable weighted duration`

Golden notes have weight 2; normal and rap notes weight 1; freestyle weight 0. Difficulty tolerances are easy ±100 cents, normal ±50 cents, hard ±25 cents. Pitch matches require enough energy and detector confidence. Rap only checks input energy, **not speech recognition or lyric correctness**. Background music, noise, or another person's voice can count as input. This is a casual karaoke game, not an identity or anti-cheat system.

Repeated, stale, and out-of-order samples do not add repeated note credit. Individual sample spans are capped at 80 ms. Silence does not earn points. Audio buffering suspends scoring. Manual input timing compensation shifts captured samples against media time; it is not automatic acoustic calibration.

Rehearsal has no score. Seeking, changing speed away from 1×, a microphone interruption, or an audio/chart cut marks a singing run as unranked practice. No native phrase bonuses, native rank thresholds, native database import, or cross-platform score comparability is claimed.

## Browsers and microphones

Required for singing: JavaScript modules, Web Audio, AudioWorklet, Web Workers, `getUserMedia`, and microphone permission on HTTPS or localhost. ZIP deflate uses the browser's `DecompressionStream('deflate-raw')`; use plain folders/files when unsupported. IndexedDB and service workers are optional persistence/offline capabilities.

Chromium is the integration-test target. Safari, Firefox, iOS, Android, Bluetooth microphones, actual multi-device input, and long karaoke sessions still need physical-device validation. Do not infer their reliability from headless Chromium tests. Browser codec support determines whether a given MP3/AAC/OGG/MP4/WebM file plays. A renamed extension cannot fix an incompatible codec.

Two players require **two distinct input devices** exposed by the browser. This version does not split a stereo USB microphone receiver into separate singers, separate voices from one mixed microphone, or turn phones into network microphones. OS audio-routing tools may expose separate devices, but they have not been tested here.

Microphone capture remains active after leaving a song for another song or the library so Soundcheck can be reused. Disconnect in Soundcheck to release access; page exit also stops tracks. No microphone stream is monitored back to speakers, stored, or uploaded.

## Import and storage boundaries

Song folders are selected by the user; a static site cannot silently scan your hard disk. Import the chart and media together. Paths are case-insensitive for matching, prefer the correct relative directory, and reject traversal outside the selected root. Basename fallback is permitted only when unambiguous.

ZIP32 stored and deflate entries are supported with CRC checks. Encrypted, split, ZIP64, and unsupported compression archives are rejected. ZIP limits: 256 MiB compressed input and total expanded payload, 4,000 entries, maximum compression ratio 1,000. Use folder import for larger collections. Non-UTF-8 legacy ZIP filename encodings are not supported reliably. Nested ZIPs are not recursively imported.

"Remember new imports" copies associated blobs into origin-local IndexedDB. Browser quotas, private-browsing policies, eviction, and clearing site data can remove these copies. Keep the original collection elsewhere. Favorites/settings/high scores use localStorage. A different hostname, Pages preview, port, or browser has separate storage. There is no cloud synchronization, account system, or guaranteed permanent storage.

## Not ported

Full native graphical song editor; automatic note generation, pitch transcription and stem separation; online/phone companion protocols; network multiplayer; native controller/plugin integration; native theming and translations; account-based leaderboards; native settings and database migration. These are not dormant buttons or mocked API responses: they are explicitly outside this release.
