import { test } from "node:test";
import assert from "node:assert/strict";
import { corpusDisplayName, parseCorpusPayload, parseTopsCsv } from "./import-corpus.js";

test("parses CORPUS TIPLOCDATA JSON", () => {
  const rows = parseCorpusPayload(
    Buffer.from(
      JSON.stringify({
        TIPLOCDATA: [
          {
            STANOX: "16401",
            TIPLOC: "LEEDSWJ",
            "3ALPHA": "   ",
            NLCDESC: "LEEDS WEST JN",
          },
          {
            STANOX: "16400",
            TIPLOC: "LEEDS",
            "3ALPHA": "LDS",
            NLCDESC: "LEEDS",
          },
        ],
      }),
    ),
  );
  assert.equal(rows[0].tiploc, "LEEDSWJ");
  assert.equal(rows[0].crs, null);
  assert.equal(rows[0].name, "Leeds West Junction");
  assert.equal(rows[1].crs, "LDS");
  assert.equal(rows[1].name, "Leeds");
});

test("title-cases CORPUS names", () => {
  assert.equal(corpusDisplayName("ARMLEY JN", "ARMLJCN"), "Armley Junction");
});

test("parses TOPS STANOX csv", () => {
  const rows = parseTopsCsv("17041,MENSTON  \n17051,GUISELEY\n");
  assert.equal(rows[0].stanox, "17041");
  assert.equal(rows[0].name, "Menston");
});

test("parses RDM NLC XML", () => {
  const xml = `<?xml version="1.0"?>
<ns2:TSDBData xmlns:ns2="http://tempuri.org/XMLSchema.xsd">
  <ns2:TSDBDataItem>
    <ns2:NLCTiplocCode>ARMLJCN</ns2:NLCTiplocCode>
    <ns2:NLCDescription>ARMLEY JUNCTION</ns2:NLCDescription>
  </ns2:TSDBDataItem>
  <ns2:TSDBDataItem>
    <ns2:NLCTiplocCode>LEEDS</ns2:NLCTiplocCode>
    <ns2:NLCCrsCode>LDS</ns2:NLCCrsCode>
    <ns2:NLCDescription>LEEDS</ns2:NLCDescription>
    <ns2:NLCStanoxCode>16400</ns2:NLCStanoxCode>
  </ns2:TSDBDataItem>
</ns2:TSDBData>`;
  const rows = parseCorpusPayload(Buffer.from(xml));
  assert.equal(rows[0].name, "Armley Junction");
  assert.equal(rows[1].crs, "LDS");
  assert.equal(rows[1].name, "Leeds");
});
