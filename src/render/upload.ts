import type * as THREE from 'three';

// One texSubImage2D for a dirty rectangle of a DataTexture, straight from its
// CPU array (UNPACK_ROW_LENGTH strides the source rows, so nothing is copied).
// three.js's own update ranges upload one row per call; paint uploads must
// stay at most one call per texture per frame.
//
// Returns false when the texture has never been uploaded (the caller should
// set needsUpdate instead and let three.js do the first full upload).

export function uploadRect(
  renderer: THREE.WebGLRenderer,
  tex: THREE.DataTexture,
  x: number, y: number, w: number, h: number,
  glFormat: number, glType: number, channels: number,
): boolean {
  const props = renderer.properties.get(tex) as { __webglTexture?: WebGLTexture };
  if (!props.__webglTexture || tex.needsUpdate) return false;
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const st = renderer.state;
  const img = tex.image as { width: number; data: ArrayBufferView };
  st.activeTexture(gl.TEXTURE0);
  st.bindTexture(gl.TEXTURE_2D, props.__webglTexture);
  st.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  st.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  st.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  st.pixelStorei(gl.UNPACK_ROW_LENGTH, img.width);
  st.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
  st.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, w, h, glFormat, glType, img.data, (y * img.width + x) * channels);
  st.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
  return true;
}
