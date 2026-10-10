const tabs = [...document.querySelectorAll('[role="tab"]')];
const $ = (id) => document.getElementById(id);
let dictionaryBytes = 0;
let pending = false;

const formatBytes = (bytes) => bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;

function renderStories(items) {
  $('result-count').textContent = `${String(items.length).padStart(2, '0')} RESULTS`;
  $('story-grid').innerHTML = items.map((item) => `
    <article class="story-card">
      <img class="story-image" src="${item.image}" alt="${item.title}" loading="lazy" />
      <div class="story-body">
        <div class="story-top"><span>${item.category} · ${item.location}</span><span class="story-rating">★ ${item.rating.toFixed(2)}</span></div>
        <h3>${item.title}</h3><p>${item.description}</p>
        <div class="story-bottom"><span>Curated for a slower trip</span><strong>$${item.price} <span style="font-weight:400;color:#879088">/ night</span></strong></div>
      </div>
    </article>`).join('');
  $('story-grid').setAttribute('aria-busy', 'false');
}

async function load(mode) {
  if (pending) return;
  pending = true;
  tabs.forEach((tab) => tab.setAttribute('aria-selected', String(tab.dataset.mode === mode)));
  $('status').textContent = 'Request in flight…';
  $('story-grid').setAttribute('aria-busy', 'true');
  $('reload').disabled = true;
  const started = performance.now();
  try {
    // The browser adds Available-Dictionary and Content-Encoding negotiation itself.
    // JavaScript cannot set Accept-Encoding or access the browser's dictionary store.
    const response = await fetch(`/api/items?mode=${mode}&_=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Request failed (${response.status})`);
    const wireBytes = Number(response.headers.get('X-Wire-Bytes')) || 0;
    const originalBytes = Number(response.headers.get('X-Original-Bytes')) || 0;
    const encoding = response.headers.get('X-Demo-Mode') || response.headers.get('Content-Encoding') || 'identity';
    const data = await response.json();
    renderStories(data.items);

    dictionaryBytes ||= Number(response.headers.get('X-Dictionary-Bytes')) || 0;
    const ratio = originalBytes ? Math.max(0, 1 - wireBytes / originalBytes) : 0;
    $('payload-size').textContent = formatBytes(originalBytes);
    $('wire-size').textContent = formatBytes(wireBytes);
    $('saving').textContent = `${Math.round(ratio * 100)}%`;
    $('content-encoding').textContent = encoding;
    $('dict-cost').textContent = mode === 'dictionary' ? formatBytes(dictionaryBytes) : '—';
    $('dict-caption').textContent = mode === 'dictionary' ? 'Downloaded by Chrome, once per cache lifetime' : 'Not negotiated';
    $('wire-caption').textContent = mode === 'dictionary' && encoding !== 'dcb'
      ? 'Waiting for Chrome to cache the dictionary; this response fell back'
      : mode === 'dictionary' ? 'Dictionary-compressed response body' : 'Response payload only';
    $('encoding-caption').textContent = mode === 'dictionary'
      ? encoding === 'dcb' ? 'Real shared Brotli dictionary' : 'Dictionary unavailable; server fallback'
      : 'Server-selected response encoding';
    $('bar-fill').style.width = `${Math.max(2, Math.min(100, wireBytes / originalBytes * 100))}%`;
    $('bar-legend').textContent = `${encoding} ${Math.round(wireBytes / originalBytes * 100)}%`;
    $('plain-tick').textContent = formatBytes(originalBytes);
    const message = mode === 'dictionary' && encoding !== 'dcb'
      ? 'Chrome has not offered the dictionary yet. Wait a moment, then Fetch again.'
      : mode === 'dictionary' ? 'Chrome offered the dictionary; the server returned dcb.' : `Fetched using ${encoding}.`;
    $('status').textContent = `Fetched in ${(performance.now() - started).toFixed(0)} ms · ${data.total} records · ${message}`;
    $('notice').style.display = mode === 'dictionary' ? 'flex' : 'none';
    $('method-pill').textContent = `GET /api/items?mode=${mode}`;
  } catch (error) {
    $('status').textContent = error.message;
    $('story-grid').setAttribute('aria-busy', 'false');
  } finally {
    pending = false;
    $('reload').disabled = false;
  }
}

tabs.forEach((tab) => tab.addEventListener('click', () => load(tab.dataset.mode)));
$('reload').addEventListener('click', () => load(tabs.find((tab) => tab.getAttribute('aria-selected') === 'true')?.dataset.mode || 'br'));
$('copy-chrome-link').addEventListener('click', async () => {
  const address = 'chrome://net-internals/#sharedDictionary';
  try {
    await navigator.clipboard.writeText(address);
    $('copy-status').textContent = 'Copied — paste it into Chrome’s address bar.';
  } catch {
    $('copy-status').textContent = `Copy this into Chrome’s address bar: ${address}`;
  }
});
load('dictionary');
