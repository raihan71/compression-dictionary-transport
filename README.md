# Web Compression Lab

A small conference demo that fetches the same travel-card JSON in four modes: plain, gzip, Brotli, and real browser-managed Compression Dictionary Transport (CDT). The dictionary tab serves an RFC 9842 `dcb` response when the browser has cached the advertised dictionary and sends its matching hash. Local JPEG images are fetched separately from the JSON.

## Run it

Requires Node.js 20 or newer.

```sh
cd web-compression-demo
pnpm install
pnpm start
```

Open <http://localhost:4178>. Click the four tabs, then use **Fetch again** to repeat a request. The server emits real `Content-Encoding: gzip` and `Content-Encoding: br` response bodies for those tabs. The browser transparently decodes them before the JSON reaches the UI; `X-Wire-Bytes` reports the compressed body length measured by the server, and `X-Original-Bytes` reports the JSON length before compression. These figures exclude response headers, TLS, and the separately fetched images.

## Open Chrome's shared dictionary page

The demo has an **Open Chrome page** shortcut and a **Copy address** button for `chrome://net-internals/#sharedDictionary`. If Chrome blocks the direct link, copy the address and paste it into Chrome's address bar. This internal page inspects or clears cached dictionaries; it does not switch CDT on. The demo itself advertises `/api/dictionary`, serves it with `Use-As-Dictionary`, and makes matching dictionary-compressed responses available. Browser support is experimental, so a browser without CDT support will safely fall back to Brotli.

## Show the real dictionary flow

Use a current Chromium build with Compression Dictionary Transport support. `http://localhost` is treated as a secure context by browsers; for a non-local host, serve the app over HTTPS. The protocol and browser support remain experimental and can vary by version.

1. Open DevTools Network before loading the page and enable **Preserve log**. Reload `http://localhost:4178`.
2. Find the document response and confirm `Link: </api/dictionary>; rel="compression-dictionary"`.
3. Find `/api/dictionary`. Its response should be `200`, include `Use-As-Dictionary: match="/api/items*", id="catalog-v1"`, and have positive `Cache-Control` freshness.
4. The page automatically requests `/api/items?mode=dictionary`. The first request may use ordinary `br` while Chrome downloads/stores the dictionary. Wait for that download, then click **Fetch again**.
5. Inspect the later `/api/items?mode=dictionary` request. A supporting browser should send `Available-Dictionary` and `Dictionary-ID: "catalog-v1"`, and include `dcb` in `Accept-Encoding`; the response should show `Content-Encoding: dcb`. The UI labels the actual selected encoding and never claims success when the server fell back.
6. Use **Open Chrome page** to inspect the browser's shared dictionary store. The entry is scoped to this site's origin/profile and may be cleared there.

The dictionary file is raw UTF-8 text containing common JSON/API phrases. The server hashes the exact bytes with SHA-256 and selects `dcb` only when the request's structured-field byte sequence matches that hash, the dictionary ID matches, and `dcb` is acceptable. It Brotli-compresses the original JSON using those bytes as the shared LZ77 dictionary and prepends the RFC 9842 `dcb` framing (magic bytes and the same SHA-256 hash). The browser validates and decodes it automatically; JavaScript receives ordinary JSON. `Vary: Accept-Encoding, Available-Dictionary, Dictionary-ID` is set on the API response. The response is `no-store` so the demonstration always exercises a fresh negotiation rather than a cached variant.

To use another port:

```sh
PORT=8080 node server.mjs
```

## Present the slides

In a second terminal, start the slide workspace:

```sh
cd ../my-slides/web-compression
pnpm dev
```

Open `http://localhost:5173/s/web-compression-conference`. Press **F** for fullscreen and **P** for presenter view with speaker notes. Keep the app open at `http://localhost:4178` for the live demo.

## What each tab demonstrates

- **Plain** sends the JSON bytes without a content encoding.
- **gzip** applies gzip/DEFLATE at level 6.
- **Brotli** applies Brotli at quality 5.
- **Shared dictionary** requests the same JSON normally. The browser manages the dictionary; the server returns `dcb` only after receiving the matching `Available-Dictionary` hash, and otherwise falls back to Brotli.

The final tab exercises the separate-dictionary `dcb` path from Compression Dictionary Transport. A production deployment also needs HTTPS, cache variation, dictionary lifecycle/versioning, and compatible clients and server infrastructure. See [RFC 9842](https://www.rfc-editor.org/rfc/rfc9842.html) for the protocol.

### What actual CDT does

The key idea is reuse **between related responses**, not just shortening repeated JSON keys inside one response. The browser and server manage this through HTTP; page JavaScript does not fetch and expand the dictionary itself.

1. On an initial page/resource response, the server sends a `Link` header that marks a resource as a compression dictionary, for example `Link: </dict>; rel="compression-dictionary"`.
2. The browser can download that dictionary and cache it. Its response includes `Use-As-Dictionary`, which tells the browser which later URLs can use it.
3. On a later matching request, the browser advertises the cached dictionary with `Available-Dictionary` and advertises supported encodings in `Accept-Encoding`.
4. If the server supports the matching dictionary and encoding, it responds with a dictionary-compressed body such as `Content-Encoding: dcb` (shared Brotli). The browser decodes it automatically before the page reads the response.

For cacheable responses, the server must vary caches on the relevant request headers, including `Accept-Encoding` and `Available-Dictionary`. RFC 9842 restricts CDT to secure contexts (HTTPS). The complete negotiation details are in [RFC 9842](https://www.rfc-editor.org/rfc/rfc9842.html).

Chrome's [Google Search case study](https://developer.chrome.com/blog/search-compression-dictionaries) shows this flow in DevTools: a first result page used ordinary Brotli at 107 kB; a later reload used dictionary-compressed Brotli (`dcb`) at about 60 kB. The article reports a 23% average HTML payload reduction across Chrome users compared with Brotli, including visits where no dictionary was available. Those are Google's reported measurements, not results from this sample app.

### How this demo relates

The demo's **Shared dictionary** tab exercises browser-managed dictionary negotiation and `dcb`. The server uses the `brotli-compress` package because Node's built-in Brotli API does not expose custom dictionary compression. The library's raw dictionary mode is compatible with the reference Brotli encoder's custom dictionary mode; the server applies the framing required by RFC 9842.

Compression results depend on input, compressor settings, and response size. This page reports this sample's bytes, not a universal ranking. Images are not part of the JSON compression byte count. JPEG, WebP, AVIF, PNG, and video already use specialized compression; recompressing their encoded bytes with gzip/Brotli usually saves little or may add overhead.

## Files

- `server.mjs` — sample server, negotiation, and HTTP encoders.
- `public/catalog-dictionary.txt` — shared bytes used by browser and Brotli encoder.
- `public/index.html` — UI structure.
- `public/styles.css` — responsive visual styling.
- `public/app.js` — fetch, tab state, metrics, and rendering; it does not read or manage the browser dictionary.
- `public/images/` — local JPEG assets for the fetched records.
- `../my-slides/web-compression/slides/web-compression-conference/index.tsx` — conference deck with speaker notes.

## Suggested live demo

1. Start on **Plain** and point out that the rendered cards stay the same.
2. Click **gzip**, then **Brotli**. Compare response bytes for this one JSON sample.
3. Choose **Shared dictionary**. Explain that the first request can fall back while the browser stores the advertised dictionary; click **Fetch again** and inspect the request/response headers for `Available-Dictionary` and `Content-Encoding: dcb`.
4. Use the Chrome shortcut to inspect the shared dictionary store for this local origin.
5. Point to the photos: the JSON was compressed; the image requests are separate and their source formats already compress image data.

## References

- [RFC 9842 — Compression Dictionary Transport](https://www.rfc-editor.org/rfc/rfc9842.html)
- [RFC 7932 — Brotli Compressed Data Format](https://www.rfc-editor.org/rfc/rfc7932.html)
- [RFC 1952 — GZIP File Format](https://www.rfc-editor.org/rfc/rfc1952.html)
