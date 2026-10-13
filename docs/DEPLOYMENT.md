# Cloudflare Pages deployment

Documentation checked October 12, 2026. No account or site has been created by this release.

## Recommended: Git integration

Put the source tree in your public Git repository, retaining LICENSE, NOTICE.md, and the upstream MIT notice. Connect that repository to a **Pages** project. Use framework None, repository root, build command `npm run check`, output `dist`, Node 22. The check command runs unit tests and generates the static output. The supplied GitHub Actions workflow also tests/builds and attaches dist as an artifact; it does not deploy automatically or contain secrets.

Once your initial Pages URL works, add the custom domain through Pages. Keep HTTPS enabled: a remote plain-HTTP LAN URL will not provide normal microphone access. Test at the final hostname, because permissions and saved browser libraries are origin-specific.

## Fast smoke deployment: Direct Upload

The prebuilt site archive has index.html at its root. In Cloudflare Workers & Pages, create a Pages application using Direct Upload, then upload that ZIP or its extracted directory. This build has no Functions.

Alternatively, from the source directory after `npm run build`:

```sh
npx wrangler login
npx wrangler pages project create ultrastar-play-static --production-branch main
npx wrangler pages deploy dist --project-name ultrastar-play-static --branch main
```

Wrangler accepts a directory, not a ZIP. It downloads as a deployment tool when using npx; it is not needed by the running website. Use your own unique project name if this name is taken. A new Direct Upload project cannot later be switched into a Git-integrated project; create a Git-integrated project initially for automatic repository deployments. An existing Git-integrated project can also receive Wrangler deployments.

## Hosting media

The shipped catalog is empty; the built-in demo is generated locally. Most deployments need no media hosting at all because users import their own files.

For an administrator-managed collection, edit `songs/catalog.json`. The implementation accepts an array or `{ "songs": [...] }`. Each entry uses `chart` and optional explicit media keys; all relative paths resolve against the catalog URL:

```json
{
  "songs": [
    {
      "chart": "./example/song.txt",
      "audio": "./example/song.mp3",
      "cover": "./example/cover.jpg",
      "video": "https://media.example.org/example/video.mp4"
    }
  ]
}
```

Only list files you are authorized to distribute. Public URLs are public assets, not an access-control mechanism. The chart's media filenames can also resolve relative to its own URL when explicit catalog overrides are absent. Do not commit secrets, signed-URL credentials, private music collections, or Cloudflare API tokens.

Each individual Pages asset must be at most **25 MiB**. The build checks this. The default website is far below that. Keep large hosted audio/video on a static media host such as an appropriately configured public R2 bucket/custom domain; this is optional, not a requirement of the application. Remote chart fetches need CORS; remote media needs working HTTPS delivery and browser-supported codecs. Byte-range support improves media seeking. Adjust CSP only as necessary, never enable arbitrary remote scripts.

Catalog load currently reads up to 1,000 chart entries sequentially with per-request timeouts. This is not optimized for a huge hosted catalog; keep the initial catalog modest. A folder importer is more suitable for a personal collection.

## Release checks

Run `npm ci && npm run check`; serve dist over localhost; run `tests/browser_smoke.py` when Python Playwright and Chromium are installed; manually test the production URL with real microphones. Check page console, mic permission, ZIP import, video synchronization, pause/resume, and browser persistence. Test a phone separately before relying on it for a party.

Keep `_headers` at the output root. It is a Cloudflare configuration file, not application JavaScript. On another host, configure equivalent HTTP headers yourself. Increment the cache identifier in sw.js on subsequent releases, and close old tabs before testing an update.

## Primary documentation

- https://developers.cloudflare.com/pages/get-started/direct-upload/
- https://developers.cloudflare.com/pages/get-started/git-integration/
- https://developers.cloudflare.com/pages/platform/limits/
- https://developers.cloudflare.com/pages/configuration/headers/
- https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia
