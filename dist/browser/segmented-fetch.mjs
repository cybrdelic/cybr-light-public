// Transport adapter for exact large assets on size-limited static hosting.
// Concatenation restores the original compressed stream; geometry is unchanged.
const nativeFetch = globalThis.fetch.bind(globalThis);
const base = new URL('./', import.meta.url);
let manifest;
const readManifest = () => manifest ||= nativeFetch(new URL('asset-parts.json', base)).then(response => {
  if (!response.ok) throw Error('Large-asset delivery manifest is unavailable');
  return response.json();
});
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input, base);
  const method = init?.method || (input instanceof Request ? input.method : 'GET');
  if (method !== 'GET' || url.origin !== base.origin || !url.pathname.startsWith(base.pathname + 'assets/')) {
    return nativeFetch(input, init);
  }
  const assets = await readManifest();
  const record = assets[url.pathname.slice(base.pathname.length)];
  if (!record) return nativeFetch(input, init);
  let part = 0, reader;
  const stream = new ReadableStream({
    async pull(controller) {
      try {
        while (part < record.parts.length) {
          if (!reader) {
            const next = await nativeFetch(new URL(record.parts[part].url || record.parts[part].path, base), init);
            if (!next.ok || !next.body) throw Error('Missing large-asset part: ' + record.parts[part].path);
            reader = next.body.getReader();
          }
          const chunk = await reader.read();
          if (!chunk.done) { controller.enqueue(chunk.value); return; }
          reader.releaseLock(); reader = undefined; part++;
        }
        controller.close();
      } catch (error) { controller.error(error); }
    },
    async cancel(reason) { await reader?.cancel(reason); },
  });
  return new Response(stream, {headers: {
    'content-type': record.contentType || 'application/octet-stream', 'content-length': String(record.bytes),
  }});
};
