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

// The same, from another array than the texture's own (srcW texels a row, the rect's corner at (sx, sy) in it): a tile mask's rect into its
// slot in its region's mask (GroundPaint, Release A 1a). The texture must have been made (renderer.initTexture): nothing here falls back.
export function uploadRectFrom(
  renderer: THREE.WebGLRenderer,
  tex: THREE.Texture,
  x: number, y: number, w: number, h: number,
  glFormat: number, glType: number, channels: number,
  src: ArrayBufferView, srcW: number, sx: number, sy: number,
): void {
  const props = renderer.properties.get(tex) as { __webglTexture?: WebGLTexture };
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const st = renderer.state;
  st.activeTexture(gl.TEXTURE0);
  st.bindTexture(gl.TEXTURE_2D, props.__webglTexture!);
  st.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  st.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  st.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  st.pixelStorei(gl.UNPACK_ROW_LENGTH, srcW);
  st.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
  st.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, w, h, glFormat, glType, src, (sy * srcW + sx) * channels);
  st.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
}
