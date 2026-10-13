# Attribution and provenance

UltraStar Play Static 0.1.0 is a browser-native reimplementation informed by the MIT-licensed UltraStar Play project:

https://github.com/UltraStar-Deluxe/Play

**Copyright (c) 2018 UltraStar Play contributors.**

The full upstream MIT license is retained in `licenses/UltraStar-Play-MIT.txt` and the combined project `LICENSE`. Preserve these notices when redistributing the software.

The upstream Unity project was inspected through its public source, particularly the chart parser and timing model. This implementation adapts format and timing behavior into JavaScript rather than mechanically transpiling the C# application. No Unity runtime or upstream third-party package is bundled. The browser UI, capture/worker pipeline, pitch detector implementation, browser-v1 scoring, storage, ZIP loader, and procedural demo are new implementations. This is not an upstream release and does not claim native feature or score parity.

## Source records inspected on October 12, 2026

Paths below are relative to `UltraStar Play/Packages/playshared/Runtime/` in the upstream repository. The hashes are Git **file blob** identifiers, not repository commit IDs.

| Reference | Blob SHA | Behavior consulted |
| --- | --- | --- |
| `Songs/UltraStarSongFormat/UltraStarSongParser/UltraStarSongVoicesParser.cs` | `33129f45fc65ada39f9ff02a3721b92457e3de6a` | Note types, lyric segmentation, relative timing, phrase breaks, voice sections |
| `Songs/UltraStarSongFormat/UltraStarSongParser/UltraStarSongParser.cs` | `f8d1a0f2351f15526b28b6d83a69fdba5d97a8d4` | Header aliases and version-dependent timing units |
| `Songs/UltraStarSongFormat/UltraStarSongMeta.cs` | `467d08e0df2e0f66e0766f5ea484c9530cc1150c` | TXT BPM factor of four, legacy time conversions |
| `Songs/SongMetaBpmUtils.cs` | `762abaf4683de1dd2a872c62d0ba0c6787fd3090` | GAP/time conversion |
| `Util/BpmUtils.cs` | `da5e1e9010d2dc2fd0213c97a6c6b9a612d71cd9` | Beat/time conversion |

Upstream root `LICENSE` blob: `ed53c1be38572750c67c3fa08a23a11107150afc`.

The format reference https://usdx.eu/format/ was also consulted. Implemented and unsupported features are enumerated in `docs/COMPATIBILITY.md`.

## Media and dependencies

The built-in "Find Your Voice" chart, lyrics, melody, synthesis code, and generated audio are original to this browser project and distributed under its MIT license. The UI and icons are original; system fonts are used without redistributing font files. There are no bundled npm libraries or remotely loaded script dependencies. Native browser APIs are not copied into this distribution.

Imported music, lyrics, cover art, and video retain their own rights. This project grants no rights to third-party media or to the UltraStar name or branding beyond applicable law.
