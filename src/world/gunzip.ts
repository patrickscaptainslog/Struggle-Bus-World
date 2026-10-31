// Inflate a gzip'd city file (the baked bundles are gzip inside the file).
// The browser's DecompressionStream where it exists; iOS Safari only has it
// from 16.4, so 15.0-16.3 get fflate (the copy three.js ships), loaded only
// there. Runs in the city worker and on the main thread.

/** True if `buf` starts with the gzip magic bytes. */
export function isGzip(buf: ArrayBuffer): boolean {
  if (buf.byteLength < 2) return false;
  const h = new Uint8Array(buf, 0, 2);
  return h[0] === 0x1f && h[1] === 0x8b;
}

export async function gunzip(buf: ArrayBuffer): Promise<ArrayBuffer> {
  if (typeof DecompressionStream !== 'undefined') {
    const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
    return await new Response(stream).arrayBuffer();
  }
  const { gunzipSync } = await import('three/examples/jsm/libs/fflate.module.js');
  const out = gunzipSync(new Uint8Array(buf));
  return out.byteOffset === 0 && out.byteLength === out.buffer.byteLength ? (out.buffer as ArrayBuffer) : (out.slice().buffer as ArrayBuffer);
}
