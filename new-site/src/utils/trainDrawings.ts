/**
 * URLs for the train drawings the Darwin API serves at /api/drawings/...
 * (index.json, and <group>/<class>/<operator>/<CODE>.svg for each car).
 *
 * `resolve` maps the site-relative `/api/darwin/...` path to the public API host (or the local
 * Next proxy on localhost); pass `resolveDarwinBrowserUrl`. Kept separate so it is easy to test.
 */
export const DRAWINGS_PATH = '/api/darwin/drawings'

export function drawingUrl(
  path: string,
  version: string | undefined,
  resolve: (input: string) => string,
): string {
  const url = resolve(`${DRAWINGS_PATH}/${path.replace(/^\/+/, '')}`)
  return version ? `${url}${url.includes('?') ? '&' : '?'}v=${encodeURIComponent(version)}` : url
}
