import { describe, expect, it } from 'vitest'
import L from 'leaflet'

import {
  guardLeafletCanvasRenderer,
  resetLeafletCanvasRendererGuardForTests,
} from './leafletCanvasRendererGuard'

describe('guardLeafletCanvasRenderer', () => {
  it('does not throw when canvas redraw runs without a context', () => {
    resetLeafletCanvasRendererGuardForTests()
    guardLeafletCanvasRenderer(L)

    const renderer = Object.create(L.Canvas.prototype) as {
      _ctx?: CanvasRenderingContext2D | null
      _container?: HTMLCanvasElement | null
      _clear: () => void
      _redraw: () => void
    }
    renderer._ctx = undefined
    renderer._container = undefined

    expect(() => renderer._clear()).not.toThrow()
    expect(() => renderer._redraw()).not.toThrow()
  })
})
