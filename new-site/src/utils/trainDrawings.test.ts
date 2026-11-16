import { describe, expect, it } from 'vitest'
import { drawingUrl } from './trainDrawings'

const toApiHost = (input: string) => 'https://api.example.test' + input.replace(/^\/api\/darwin/, '/api')
const sameOrigin = (input: string) => input

describe('drawingUrl', () => {
  it('maps a car path onto the API host and appends the version', () => {
    expect(drawingUrl('80x/800/gwr/END5.svg', 'abc123', toApiHost)).toBe(
      'https://api.example.test/api/drawings/80x/800/gwr/END5.svg?v=abc123',
    )
  })

  it('leaves out the version when there is none (the index)', () => {
    expect(drawingUrl('index.json', undefined, toApiHost)).toBe('https://api.example.test/api/drawings/index.json')
  })

  it('uses the same-origin proxy path when the resolver does (localhost)', () => {
    expect(drawingUrl('index.json', 'v1', sameOrigin)).toBe('/api/darwin/drawings/index.json?v=v1')
  })

  it('tolerates a leading slash and encodes the version', () => {
    expect(drawingUrl('/ic225/ic225/base/END3.svg', 'a b', sameOrigin)).toBe(
      '/api/darwin/drawings/ic225/ic225/base/END3.svg?v=a%20b',
    )
  })
})
