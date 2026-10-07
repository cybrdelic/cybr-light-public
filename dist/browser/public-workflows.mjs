// Expose available, cleared scene selections without changing renderer math.
const {scenes} = await fetch('./public-workflows.json').then(r => r.json());
const available = new Set(scenes);
const select = document.querySelector('#scene');
function refresh() {
  for (const option of [...select.options]) if (!available.has(option.value)) option.remove();
  const gallery = document.querySelector('#show-gallery');
  if (gallery) gallery.textContent = 'Cleared model gallery';
  const catalog = [...document.querySelectorAll('details')].find(d => d.querySelector('summary')?.textContent.startsWith('Source import catalog'));
  if (catalog) catalog.hidden = true;
}
new MutationObserver(refresh).observe(select, {childList: true});
refresh();
const nav = document.createElement('nav');
nav.style.cssText = 'display:flex;flex-wrap:wrap;gap:18px;font-size:14px';
nav.innerHTML = '<a href="./forest-game.html">Forest raster</a><a href="https://github.com/cybrdelic/cybr-light-public">Full source repository</a><a href="../cybr-light-current-source.zip">Source ZIP</a><a href="../docs/LIVE.md">Demo scope</a><a href="../LICENSE">License</a>';
document.querySelector('header').append(nav);
