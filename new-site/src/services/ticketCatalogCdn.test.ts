import { describe, expect, it } from 'vitest'
import {
  parseTicketCatalogNdjson,
  ticketCatalogCollectionPath,
} from '@/services/ticketCatalogCdn'

describe('ticketCatalogCdn', () => {
  it('parses ndjson documents and skips blank lines', () => {
    const text = [
      '{"id":"emr-midlands","shortName":"Midlands"}',
      '',
      '{"id":"sheffield-doncaster","name":"Sheffield"}',
    ].join('\n')

    expect(parseTicketCatalogNdjson(text)).toEqual([
      { id: 'emr-midlands', data: { id: 'emr-midlands', shortName: 'Midlands' } },
      { id: 'sheffield-doncaster', data: { id: 'sheffield-doncaster', name: 'Sheffield' } },
    ])
  })

  it('builds versioned collection object paths', () => {
    expect(ticketCatalogCollectionPath('20260914T123629Z', 'dpayg_fares')).toBe(
      'ticket-catalogs/20260914T123629Z/collections/dpayg_fares.ndjson.gz'
    )
  })
})
