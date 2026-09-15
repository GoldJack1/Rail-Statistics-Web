import type L from 'leaflet'

type CanvasRenderer = {
  _ctx?: CanvasRenderingContext2D | null
  _container?: HTMLCanvasElement | null
  _clear?: () => void
  _redraw?: () => void
}

let guarded = false

/**
 * Leaflet's canvas renderer crashes in Safari when a redraw runs after the
 * context is torn down (`this._ctx.clearRect`). Skip those frames.
 */
export function guardLeafletCanvasRenderer(leaflet: typeof L): void {
  if (guarded) return
  guarded = true

  const proto = leaflet.Canvas.prototype as unknown as CanvasRenderer
  const clear = proto._clear
  const redraw = proto._redraw

  if (typeof clear === 'function') {
    proto._clear = function leafletCanvasClearSafe(this: CanvasRenderer) {
      if (!this._ctx || !this._container) return
      return clear.call(this)
    }
  }

  if (typeof redraw === 'function') {
    proto._redraw = function leafletCanvasRedrawSafe(this: CanvasRenderer) {
      if (!this._ctx || !this._container) return
      return redraw.call(this)
    }
  }
}

export function resetLeafletCanvasRendererGuardForTests(): void {
  guarded = false
}
