import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { sortCallsByWttTime } from "./journey-order.js";
import { applyLiveToInferred, carryRunningLateness, dropForeignTdActuals, dropPassesOffTheLeg, dropUnreportedOrmPasses, insertIntermediateStations, insertReportedPasses, insertSchedulePasses, insertSegmentJunctions, overlayTdOnCalls, reportsForService, reportsOnServiceTiploc, retimeInferredPasses, settleUnreportedPasses } from "./query-enrich.js";
import { openDayDb } from "./db.js";
import { ensureSmartTables, importSmartPayload, parseSmartPayload } from "./import-smart.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("an inferred pass behind a real report does not keep an expected time", () => {
  const out = settleUnreportedPasses([
    { tiploc: "DLTNN", actual_source: "inferred", etp: "19:34", live_kind: "est", wtp: "19:33" },
    { tiploc: "DLTN", actual_source: "trust", atd: "19:36", wtd: "19:35" },
    { tiploc: "AHEAD", actual_source: "inferred", etp: "19:40", live_kind: "est", wtp: "19:40" },
  ]);
  assert.equal(out[0].etp, null);
  assert.equal(out[0].live_kind, null);
  assert.equal(out[2].etp, "19:40");
});

test("insertReportedPasses places a feed location by time and leaves scheduled rows", () => {
  const calls = [
    { tiploc: "MARSDEN", is_passing: 1, wtp: "18:19", atp: "18:31", actual_source: "trust" },
    { tiploc: "HUDDERS", is_passing: 0, wtd: "18:30", atd: "18:40", actual_source: "trust" },
  ];
  const out = insertReportedPasses(calls, [
    { tiploc: "SLAITHW", name: "Slaithwaite", crs: "SWT", clock: "18:34", minute: 18 * 60 + 34, source: "td" },
    { tiploc: "SIG0042", clock: "18:33", minute: 18 * 60 + 33, source: "td" },
    { tiploc: "MARSDEN", clock: "18:31", minute: 18 * 60 + 31, source: "td" },
  ]);
  assert.deepEqual(
    out.map((c) => c.tiploc),
    ["MARSDEN", "SLAITHW", "HUDDERS"],
  );
  assert.equal(out[1].atp, "18:34");
  assert.equal(out[1].actual_source, "td");
  assert.equal(out[0].actual_source, "trust");
});

test("reportsForService ignores another train on the same headcode and a point off the line", () => {
  const calls = [
    { tiploc: "DIGGLEJ", is_passing: 1, atp: "18:27" },
    { tiploc: "MARSDEN", is_passing: 1, atp: "18:31" },
    { tiploc: "NCL", is_passing: 0, wta: "20:24" },
  ];
  const coords = new Map([
    ["DIGGLEJ", { e: 0, n: 0 }],
    ["MARSDEN", { e: 8000, n: 0 }],
    ["NCL", { e: 100000, n: 0 }],
    ["UPRMILL", { e: 4000, n: 40 }],
    ["DEANLNE", { e: -30000, n: 0 }],
  ]);
  const out = reportsForService(
    calls,
    [
      { tiploc: "DALS", clock: "09:43", minute: 9 * 60 + 43, source: "td" },
      { tiploc: "DEANLNE", clock: "18:27", minute: 18 * 60 + 27, source: "td" },
      { tiploc: "UPRMILL", clock: "18:29", minute: 18 * 60 + 29, source: "td" },
    ],
    coords,
  );
  assert.deepEqual(out.map((row) => row.tiploc), ["UPRMILL"]);
});

test("carryRunningLateness holds the last real delay and stays in order", () => {
  const out = carryRunningLateness([
    { tiploc: "SLAITHW", is_passing: 1, wtp: "19:53", atp: "20:00", actual_source: "td" },
    { tiploc: "SPWDJN", is_passing: 1, atp: "20:06", actual_source: "inferred" },
    { tiploc: "HUDDERS", is_passing: 0, wta: "19:58", wtd: "20:01", ata: "20:05", atd: "20:06", actual_source: "trust" },
    { tiploc: "HOLBJCN", is_passing: 1, wtp: "20:19", actual_source: "inferred" },
    { tiploc: "LEEDS", is_passing: 0, wta: "20:22", wtd: "20:27", eta: "20:22", etd: "20:27" },
    { tiploc: "NCL", is_passing: 0, wta: "21:26", eta: "21:31" },
  ]);
  assert.equal(out[0].atp, "20:00");
  assert.equal(out[1].atp, null);
  assert.equal(out[1].etp, "20:05");
  assert.equal(out[2].atd, "20:06");
  assert.equal(out[3].etp, "20:24");
  assert.equal(out[4].etd, "20:32");
  assert.equal(out[4].eta, "20:27");
  assert.equal(out[5].eta, "21:31");
});

test("dropUnreportedOrmPasses keeps stations and named junctions, and drops yards", () => {
  const catalog = new DatabaseSync(":memory:");
  catalog.exec(`CREATE TABLE corpus (tiploc TEXT PRIMARY KEY, stanox TEXT, crs TEXT, name TEXT)`);
  catalog.prepare(`INSERT INTO corpus VALUES (?, ?, ?, ?)`).run("EGRFRTH", null, "EGF", "East Garforth");
  catalog.prepare(`INSERT INTO corpus VALUES (?, ?, ?, ?)`).run("TYN", null, "TYN", "Tyne Yard");
  catalog.prepare(`INSERT INTO corpus VALUES (?, ?, ?, ?)`).run("HOLBJCN", null, null, "Holbeck Junction");
  const calls = [
    { tiploc: "LEEDS", actual_source: null, atd: "10:01" },
    { tiploc: "HOLBJCN", actual_source: "orm", wtp: "10:02" },
    { tiploc: "EGRFRTH", actual_source: "orm", crs: "EGF", wtp: "10:03" },
    { tiploc: "TYN", actual_source: "orm", crs: "TYN", wtp: "10:04" },
  ];
  const out = dropUnreportedOrmPasses(calls, catalog);
  assert.deepEqual(
    out.map((c) => c.tiploc),
    ["LEEDS", "HOLBJCN", "EGRFRTH"],
  );
  catalog.close();
});

test("inferred pass behind a later actual takes that lateness", () => {
  const out = applyLiveToInferred(null, [
    { tiploc: "A", is_passing: 0, wtd: "15:03", atd: "15:02" },
    { tiploc: "B", is_passing: 1, wtp: "15:06", etp: "15:06", actual_source: "inferred" },
    { tiploc: "C", is_passing: 1, wtp: "15:07", atp: "15:05", actual_source: "td" },
  ], null);
  assert.equal(out[1].atp, "15:04");
  assert.equal(out[1].live_kind, "actual");
  assert.equal(out[1].actual_source, "inferred");
});

test("a passed inferred junction keeps the lateness taken from the next report", () => {
  const calls = [
    { tiploc: "MIRFEJN", is_passing: 1, wtp: "13:54", atp: "13:55", actual_source: "trust" },
    { tiploc: "THHLNWJ", is_passing: 1, wtp: "13:54", atp: "13:56", live_kind: "actual", actual_source: "inferred" },
    { tiploc: "RTHP", is_passing: 1, wtp: "13:54", atp: "13:56", actual_source: "td" },
  ];
  const carried = carryRunningLateness(calls);
  assert.equal(carried[1].atp, "13:56");
  const settled = settleUnreportedPasses(carried);
  assert.equal(settled[1].atp, "13:56");
});

test("a junction other trains take is kept when it sits between two calls", () => {
  const coords = new Map([
    ["MIRFEJN", { e: 0, n: 0 }],
    ["THHLNWJ", { e: 500, n: 10 }],
    ["RTHP", { e: 1000, n: 0 }],
    ["HORBRYJ", { e: 500, n: 5000 }],
  ]);
  const sequences = [
    ["MIRFEJN", "THHLNWJ", "HORBRYJ"],
    ["MIRFEJN", "THHLNWJ", "HORBRYJ"],
    ["MIRFEJN", "THHLNWJ", "HORBRYJ"],
    ["MIRFEJN", "HORBRYJ"],
  ];
  const out = insertSegmentJunctions(
    [
      { tiploc: "MIRFEJN", wtp: "13:54" },
      { tiploc: "RTHP", wtp: "13:56" },
    ],
    sequences,
    coords,
  );
  assert.deepEqual(out.map((c) => c.tiploc), ["MIRFEJN", "THHLNWJ", "RTHP"]);
  assert.equal(out[1].actual_source, "inferred");
  assert.equal(out[1].wtp, "13:55");
  assert.equal(out[1].etp, "13:55");
  assert.equal(out[1].atp, null);
});

test("a named junction on the straight line between two calls is shown once", () => {
  const coords = new Map([
    ["SLTHWTE", { e: 0, n: 0 }],
    ["HDRSFLD", { e: 1000, n: 0 }],
    ["LEEDSWJ", { e: 2000, n: 0 }],
  ]);
  const out = insertSegmentJunctions(
    [
      { tiploc: "SLTHWTE", wtp: "16:10" },
      { tiploc: "HDRSFLD", wtd: "16:16", wta: "16:15" },
      { tiploc: "LEEDSWJ", wtp: "16:42", line: "UM" },
    ],
    [],
    coords,
    [
      { tiploc: "SPWDJN", e: 890, n: 0 },
      { tiploc: "LEEDSWJ", e: 1500, n: 0 },
    ],
  );
  assert.deepEqual(out.map((c) => c.tiploc), ["SLTHWTE", "SPWDJN", "HDRSFLD", "LEEDSWJ"]);
  assert.equal(out.filter((c) => c.tiploc === "LEEDSWJ").length, 1);
  assert.equal(out[1].actual_source, "inferred");
  assert.equal(out[1].wtp, "16:14");
});

test("an approach junction is timed to the arrival and stays before the station", () => {
  const coords = new Map([
    ["MILESPL", { e: 0, n: 0 }],
    ["MNCRVIC", { e: 2000, n: 0 }],
    ["MNCRDST", { e: 3000, n: 0 }],
  ]);
  const out = insertSegmentJunctions(
    [
      { tiploc: "MILESPL", wtp: "14:33", atp: "14:37:01" },
      { tiploc: "MNCRVIC", wta: "14:35", wtd: "14:40", ata: "14:39", atd: "14:41:23" },
      { tiploc: "MNCRDST", wtp: "14:41½", atp: "14:42" },
    ],
    [],
    coords,
    [{ tiploc: "MNCRVEJ", e: 1800, n: 0 }],
  );
  assert.equal(out[1].tiploc, "MNCRVEJ");
  assert.equal(out[1].wtp, "14:34");
  assert.ok(out[1].atp < "14:39");
  assert.deepEqual(
    sortCallsByWttTime(out).map((row) => row.tiploc),
    ["MILESPL", "MNCRVEJ", "MNCRVIC", "MNCRDST"],
  );
});

test("an inferred junction moved before a station gets a time between its new neighbours", () => {
  const out = retimeInferredPasses([
    { tiploc: "TEESYSB", wtp: "11:18", atp: "11:18:19", actual_source: "inferred" },
    { tiploc: "TABYEJN", wtp: "11:21", atp: "11:20:44", actual_source: "inferred" },
    { tiploc: "TABY", wtd: "11:20", atd: "11:20:38", actual_source: "trust" },
  ]);
  assert.equal(out[1].wtp, "11:19");
  assert.equal(out[1].atp > "11:18:19" && out[1].atp < "11:20:38", true);
  assert.equal(out[0].wtp, "11:18");
});

test("a junction just after a half-minute call is not given an earlier time", () => {
  const coords = new Map([
    ["HDRSFLD", { e: 0, n: 0 }],
    ["SPWDJN", { e: 50, n: 0 }],
    ["MRSN", { e: 1000, n: 0 }],
  ]);
  const out = insertSegmentJunctions(
    [
      { tiploc: "HDRSFLD", wtd: "13:07½" },
      { tiploc: "MRSN", wtp: "13:14½" },
    ],
    [],
    coords,
    [{ tiploc: "SPWDJN", e: 50, n: 0 }],
  );
  assert.deepEqual(out.map((c) => c.tiploc), ["HDRSFLD", "SPWDJN", "MRSN"]);
  assert.equal(out[1].wtp, "13:08");
});

test("a station plotted on a junction already on the train is not invented", () => {
  const coords = new Map([
    ["ARDWCKJ", { e: 0, n: 0 }],
    ["ARDWICK", { e: 200, n: 0 }],
    ["LNGSTN", { e: 900, n: 0 }],
  ]);
  const out = insertSegmentJunctions(
    [
      { tiploc: "ARDWCKJ", wtp: "13:52" },
      { tiploc: "LNGSTN", wtp: "13:53" },
    ],
    [
      ["ARDWCKJ", "ARDWICK", "LNGSTN"],
      ["ARDWCKJ", "ARDWICK", "LNGSTN"],
      ["ARDWCKJ", "ARDWICK", "LNGSTN"],
    ],
    coords,
  );
  assert.deepEqual(out.map((c) => c.tiploc), ["ARDWCKJ", "LNGSTN"]);
});

test("a booked pass off the leg between its neighbours is left out", () => {
  const off = dropPassesOffTheLeg(
    [
      { tiploc: "LOWMOOR", is_passing: 0, crs: "LMR" },
      { tiploc: "MLLNJN", is_passing: 1, crs: null },
      { tiploc: "BRADIN", is_passing: 0, crs: "BDI" },
    ],
    new Map([
      ["LOWMOOR", { e: 0, n: 5000 }],
      ["MLLNJN", { e: -9000, n: 0 }],
      ["BRADIN", { e: 200, n: 10000 }],
    ]),
  );
  assert.deepEqual(off.map((call) => call.tiploc), ["LOWMOOR", "BRADIN"]);

  const on = dropPassesOffTheLeg(
    [
      { tiploc: "BRHOUSE", is_passing: 0, crs: "BGH" },
      { tiploc: "GRTLNDJ", is_passing: 1, crs: null },
      { tiploc: "DYCLJN", is_passing: 1, crs: null },
    ],
    new Map([
      ["BRHOUSE", { e: 0, n: 0 }],
      ["GRTLNDJ", { e: 4000, n: 200 }],
      ["DYCLJN", { e: 8000, n: 0 }],
    ]),
  );
  assert.deepEqual(on.map((call) => call.tiploc), ["BRHOUSE", "GRTLNDJ", "DYCLJN"]);
});

test("the other junction out of a stop is not added on the route this train takes", () => {
  const coords = new Map([
    ["MIRFILD", { e: 0, n: 0 }],
    ["HETNLJN", { e: 1000, n: 0 }],
    ["BRLYWJN", { e: 1800, n: 400 }],
  ]);
  const viaEast = ["HETNLEJ", "BRLYWJN"];
  const viaLodge = ["MIRFILD", "HETNLJN", "BRLYWJN"];
  const out = insertSegmentJunctions(
    [
      { tiploc: "MIRFILD", wtd: "15:14" },
      { tiploc: "HETNLJN", wtp: "15:18" },
    ],
    [viaLodge, viaLodge, viaLodge, viaEast, viaEast, viaEast],
    coords,
    [
      { tiploc: "HETNLEJ", e: 700, n: 0 },
      { tiploc: "HETNLJN", e: 1000, n: 0 },
    ],
  );
  assert.deepEqual(out.map((c) => c.tiploc), ["MIRFILD", "HETNLJN"]);
});

test("a junction off the chord, or the same signalling place, is not added", () => {
  const coords = new Map([
    ["SLTHWTE", { e: 0, n: 0 }],
    ["HDRSFLD", { e: 1000, n: 0 }],
    ["ARDWCKJ", { e: 0, n: 0 }],
    ["ASHBRYS", { e: 1000, n: 0 }],
  ]);
  const springwood = insertSegmentJunctions(
    [{ tiploc: "SLTHWTE", wtp: "16:10" }, { tiploc: "HDRSFLD", wtd: "16:16" }],
    [],
    coords,
    [{ tiploc: "SPWDJN", e: 500, n: 350 }],
  );
  assert.deepEqual(springwood.map((c) => c.tiploc), ["SLTHWTE", "HDRSFLD"]);
  const ardwick = insertSegmentJunctions(
    [{ tiploc: "ARDWCKJ", wtp: "13:17" }, { tiploc: "ASHBRYS", wtp: "13:19" }],
    [],
    coords,
    [
      { tiploc: "ARDWCKJ", e: 0, n: 0, stanox: "32009" },
      { tiploc: "ARDWKEJ", e: 400, n: 0, stanox: "32009" },
    ],
  );
  assert.deepEqual(ardwick.map((c) => c.tiploc), ["ARDWCKJ", "ASHBRYS"]);
});

test("a guessed junction uses the pass times of the calls either side", () => {
  const coords = new Map([
    ["MIRFEJN", { e: 0, n: 0 }],
    ["THHLNWJ", { e: 500, n: 0 }],
    ["RTHP", { e: 1000, n: 0 }],
  ]);
  const out = insertSegmentJunctions(
    [
      { tiploc: "MIRFEJN", wtp: "13:54", atp: "13:55:06", actual_source: "trust" },
      { tiploc: "RTHP", wtp: "13:56", atp: "13:56:05", actual_source: "td" },
    ],
    [
      ["MIRFEJN", "THHLNWJ", "RTHP"],
      ["MIRFEJN", "THHLNWJ", "RTHP"],
      ["MIRFEJN", "THHLNWJ", "RTHP"],
    ],
    coords,
  );
  assert.equal(out[1].wtp, "13:55");
  assert.equal(out[1].atp, "13:55:36");
  assert.equal(out[1].live_kind, "actual");
});

test("the other passing of the same junction is not given this report", () => {
  const out = applyLiveToInferred(null, [
    { tiploc: "LEEDSWJ", is_passing: 1, wtp: "14:14", atp: "14:11", actual_source: "trust" },
    { tiploc: "LEEDS", is_passing: 0, wtd: "14:23", atd: "14:23", actual_source: "darwin" },
    { tiploc: "LEEDSWJ", is_passing: 1, wtp: "14:24", atp: "14:24", actual_source: "darwin" },
  ], null);
  assert.equal(out[0].atp, "14:11");
  assert.equal(out[2].atp, "14:24");
});

test("a second spelling of a junction already on the train is the same place", () => {
  const stanox = new Map([
    ["ARDWCKJ", "32009"],
    ["ARDWKEJ", "32009"],
    ["ASHBRYS", "32050"],
    ["ASHBREJ", "32050"],
  ]);
  const out = reportsOnServiceTiploc(
    [{ tiploc: "ARDWCKJ", wtp: "13:17" }, { tiploc: "ASHBRYS", wtp: "13:18" }, { tiploc: "ASHBREJ", wtp: "13:18" }],
    [
      { tiploc: "ARDWKEJ", clock: "13:18:19" },
      { tiploc: "ASHBREJ", clock: "13:20" },
    ],
    (tiploc) => stanox.get(tiploc),
  );
  assert.deepEqual(out.map((row) => row.tiploc), ["ARDWCKJ", "ASHBREJ"]);
});

test("a siding or depot report is not added, and a real timing point still is", () => {
  const out = insertReportedPasses(
    [
      { tiploc: "HDRSFLD", wtd: "13:46" },
      { tiploc: "DEIGHTN", wtp: "13:48" },
    ],
    [
      { tiploc: "HUDHESD", name: "Hillhouse East Siding", clock: "13:50", minute: 13 * 60 + 50, source: "td" },
      { tiploc: "ARDWTMD", name: "Ardwick T.M.D", crs: "XRK", clock: "13:19", minute: 13 * 60 + 19, source: "td" },
      { tiploc: "ARDWKEJ", name: "Ardwick East Junction", clock: "13:18", minute: 13 * 60 + 18, source: "td" },
      { tiploc: "FAIRFLD", name: "Fairfield", crs: "FRF", clock: "13:25", minute: 13 * 60 + 25, source: "td" },
    ],
  );
  assert.deepEqual(out.map((c) => c.tiploc), ["ARDWKEJ", "FAIRFLD", "HDRSFLD", "DEIGHTN"]);
});

test("an estimated junction is not cleared once a later stop has reported", () => {
  const settled = settleUnreportedPasses([
    { tiploc: "MIRFEJN", atp: "13:55", actual_source: "trust" },
    { tiploc: "THHLNWJ", wtp: null, etp: "13:55", atp: null, actual_source: "inferred" },
    { tiploc: "RTHP", atp: "13:56", actual_source: "td" },
  ]);
  assert.equal(settled[1].atp, null);
  assert.equal(settled[1].etp, "13:55");
});

test("stations on this train's corridor are added and the other railway is not", () => {
  const crs = new Map([
    ["LEEDS", "LDS"],
    ["WKFLDKG", "WKK"],
    ["WDLESFD", "WDS"],
    ["CASTLFD", "CFD"],
    ["NORMNTN", "NOR"],
    ["WKFLDWG", "WKF"],
    ["HULL", "HUL"],
  ]);
  const coords = new Map([
    ["LEEDS", { e: 0, n: 0 }],
    ["METHLYJ", { e: 0, n: 5000 }],
    ["ALTFTJN", { e: 0, n: 8000 }],
    ["WKFLDKG", { e: 0, n: 12000 }],
    ["WDLESFD", { e: 400, n: 2500 }],
    ["CASTLFD", { e: 3000, n: 6000 }],
    ["NORMNTN", { e: 200, n: 10000 }],
    ["WKFLDWG", { e: -800, n: 11000 }],
    ["HULL", { e: 40000, n: 0 }],
  ]);
  const stopping = ["LEEDS", "METHLYJ", "WDLESFD", "CASTLFD", "ALTFTJN", "NORMNTN", "WKFLDKG"];
  const fast = ["LEEDS", "METHLYJ", "ALTFTJN", "WKFLDKG"];
  const west = ["LEEDS", "WKFLDWG", "WKFLDKG"];
  const stray = ["LEEDS", "METHLYJ", "HULL", "ALTFTJN", "WKFLDKG"];
  const sequences = [
    ...Array.from({ length: 8 }, () => stopping),
    ...Array.from({ length: 8 }, () => fast),
    ...Array.from({ length: 8 }, () => west),
    stray,
  ];
  const out = insertIntermediateStations(
    [
      { tiploc: "LEEDS", is_passing: 0, crs: "LDS", wtd: "16:38" },
      { tiploc: "METHLYJ", is_passing: 1, wtp: "16:48" },
      { tiploc: "ALTFTJN", is_passing: 1, wtp: "16:49" },
      { tiploc: "WKFLDKG", is_passing: 0, crs: "WKK", wta: "16:55" },
    ],
    sequences,
    (tiploc) => crs.get(tiploc) || "",
    (tiploc) => coords.get(tiploc) || null,
  );
  assert.deepEqual(
    out.map((call) => call.tiploc),
    ["LEEDS", "METHLYJ", "ALTFTJN", "WKFLDKG"],
  );
});

test("a station is added only when every schedule between the booked points passes it", () => {
  const crs = new Map([
    ["A", "AAA"],
    ["B", "BBB"],
    ["MID", "MID"],
  ]);
  const coords = new Map([
    ["A", { e: 0, n: 0 }],
    ["JN", { e: 0, n: 5000 }],
    ["MID", { e: 100, n: 2500 }],
    ["B", { e: 0, n: 10000 }],
  ]);
  const through = ["A", "MID", "JN", "B"];
  const out = insertIntermediateStations(
    [
      { tiploc: "A", is_passing: 0, crs: "AAA", wtd: "10:00" },
      { tiploc: "JN", is_passing: 1, wtp: "10:10" },
      { tiploc: "B", is_passing: 0, crs: "BBB", wta: "10:20" },
    ],
    Array.from({ length: 5 }, () => through),
    (tiploc) => crs.get(tiploc) || "",
    (tiploc) => coords.get(tiploc) || null,
  );
  assert.deepEqual(out.map((call) => call.tiploc), ["A", "MID", "JN", "B"]);
});

test("schedule pass uses the path that also reaches the next stop", () => {
  const fast = ["EUSTON", "WATFDJ", "RUGBY"];
  const slow = ["EUSTON", "SHMPSTD", "KILBNHR", "WATFDJ"];
  const wcml = ["EUSTON", "BUSHEY", "WATFDJ", "RUGBY"];
  const calls = insertSchedulePasses(
    [
      { tiploc: "EUSTON", wtd: "10:00" },
      { tiploc: "WATFDJ", wta: "10:20" },
      { tiploc: "RUGBY", wta: "10:50" },
    ],
    [fast, slow, wcml, wcml, wcml],
  );
  assert.deepEqual(calls.map((c) => c.tiploc), ["EUSTON", "BUSHEY", "WATFDJ", "RUGBY"]);
});

test("overlayTdOnCalls fills empty passing atp from td_events", () => {
  const dir = mkdtempSync(join(tmpdir(), "rail-core-"));
  const db = openDayDb(dir, "2026-10-15");
  db.exec(`
    INSERT INTO td_events (event_id, headcode, area_id, berth, from_berth, msg_type, tiploc, stanox, json, received_at)
    VALUES ('1', '9M13', 'Y2', '1234', '0000', 'CA', 'BIRTLEY', '12345', '{"CA_MSG":{"time":"131200","msg_type":"CA"}}', 1)
  `);
  const calls = [
    { tiploc: "BIRTLEY", is_passing: 1, wtp: "13:07", atp: null },
    { tiploc: "DURHAM", is_passing: 0, atd: "13:23" },
  ];
  const out = overlayTdOnCalls(db, calls, "9M13");
  assert.equal(out[0].atp, "13:12");
  assert.equal(out[0].actual_source, "td");
  assert.equal(out[1].atd, "13:23");
  db.close();
});

test("overlayTdOnCalls maps null-tiploc events via SMART", () => {
  const dir = mkdtempSync(join(tmpdir(), "rail-core-"));
  const db = openDayDb(dir, "2026-10-15");
  db.exec(`
    INSERT INTO td_events (event_id, headcode, area_id, berth, from_berth, msg_type, tiploc, stanox, json, received_at)
    VALUES ('2', '9M13', 'Y2', 'HOLB', '0001', 'CA', NULL, NULL, '{"CA_MSG":{"time":"130400","msg_type":"CA"}}', 2)
  `);
  const catalog = new DatabaseSync(":memory:");
  catalog.exec(`CREATE TABLE corpus (tiploc TEXT PRIMARY KEY, stanox TEXT, crs TEXT, name TEXT)`);
  catalog.prepare(`INSERT INTO corpus VALUES (?, ?, ?, ?)`).run("HOLBJCN", "16421", null, "Holbeck Junction");
  ensureSmartTables(catalog);
  importSmartPayload(
    catalog,
    parseSmartPayload(
      JSON.stringify({
        SMART: [{ TD: "Y2", FROMBERTH: "0001", TOBERTH: "HOLB", STANOX: "16421", EVENT: "C", PLATFORM: "" }],
      }),
    ),
  );
  const calls = [{ tiploc: "HOLBJCN", is_passing: 1, wtp: "13:04", atp: null }];
  const out = overlayTdOnCalls(db, calls, "9M13", catalog);
  assert.equal(out[0].atp, "13:04");
  assert.equal(out[0].actual_source, "td");
  db.close();
  catalog.close();
});

test("a step from the previous working is not this train running early", () => {
  const calls = [
    { tiploc: "COTNGLY", is_passing: 0, wta: "14:53", wtd: "14:53½", ata: "14:56", atd: "14:58", actual_source: "darwin" },
    { tiploc: "BRLYWJN", is_passing: 1, wtp: "15:19½", atp: "14:54", etp: "15:23", actual_source: "td", live_kind: "actual" },
    { tiploc: "BRHOUSE", is_passing: 0, wta: "15:22", wtd: "15:33", eta: "15:24", etd: "15:33" },
  ];
  const dropped = dropForeignTdActuals(calls);
  assert.equal(dropped[1].atp, null);
  assert.equal(dropped[1].etp, "15:23");
  assert.equal(dropped[0].atd, "14:58");
  const inferred = applyLiveToInferred(null, [
    dropped[0],
    { tiploc: "HETNLEJ", is_passing: 1, wtp: "15:16", actual_source: "inferred" },
    dropped[1],
  ], null);
  assert.equal(inferred[1].atp ?? null, null);
  assert.notEqual(inferred[1].etp, "14:51");
});

test("yesterday's sleeper steps are not tonight's 1M16", () => {
  const now = Date.parse("2026-10-30T21:30:00Z");
  const tonight = [
    { tiploc: "IVRNESS", is_passing: 0, wtd: "20:45", atd: "20:45", actual_source: "trust" },
    { tiploc: "ABINGTN", is_passing: 1, wtp: "02:06", atp: "02:29:10", actual_source: "td", live_kind: "actual" },
    { tiploc: "PRST", is_passing: 0, wta: "04:13½", wtd: "04:15½", eta: "04:15", etd: "04:07", actual_source: "td", live_kind: "working" },
  ];
  const dropped = dropForeignTdActuals(tonight, { rid: "202610306704564", now });
  assert.equal(dropped[0].atd, "20:45");
  assert.equal(dropped[1].atp ?? null, null);
  assert.equal(dropped[2].etd ?? null, null);
  const inserted = dropForeignTdActuals(
    [
      ...tonight,
      { tiploc: "TILEH", is_passing: 1, atp: "06:31:05", actual_source: "td", live_kind: "actual" },
    ],
    { rid: "202610306704564", now },
  );
  assert.equal(inserted.some((call) => call.tiploc === "TILEH"), false);
  const yesterday = dropForeignTdActuals(
    [
      { tiploc: "IVRNESS", is_passing: 0, wtd: "20:45" },
      { tiploc: "ABINGTN", is_passing: 1, wtp: "02:06", atp: "02:29", actual_source: "td", live_kind: "actual" },
    ],
    { rid: "202610296704565", now },
  );
  assert.equal(yesterday[1].atp, "02:29");
});

test("a morning headcode step is not this evening's pass", () => {
  const calls = [
    { tiploc: "SHEFFLD", is_passing: 0, wta: "21:56", wtd: "22:02", atd: "22:02", actual_source: "trust" },
    { tiploc: "CLAYXSJ", is_passing: 1, wtp: "22:30", atp: "09:20", actual_source: "td", live_kind: "actual" },
    { tiploc: "DRBYLNW", is_passing: 1, wtp: "22:51", atp: "09:41:53", actual_source: "td", live_kind: "actual" },
    { tiploc: "CHFD", is_passing: 0, wta: "22:25", wtd: "22:26", eta: "22:25", etd: "22:26" },
    { tiploc: "BHAMNWS", is_passing: 0, wta: "23:28", eta: "23:28" },
  ];
  const dropped = dropForeignTdActuals(calls);
  assert.equal(dropped[1].atp, null);
  assert.equal(dropped[1].live_kind, null);
  assert.equal(dropped[2].atp, null);
  assert.equal(dropped[0].atd, "22:02");
  const inferred = applyLiveToInferred(null, [
    dropped[0],
    dropped[3],
    { tiploc: "CLAYXSJ", is_passing: 1, wtp: "22:30", actual_source: "inferred" },
    dropped[2],
  ], null);
  assert.equal(inferred[2].atp ?? null, null);
  const carried = carryRunningLateness(inferred);
  assert.equal(carried[1].eta, "22:25");
  assert.equal(carried[1].etd, "22:26");
});

test("overlayTdOnCalls ignores a step already past a timing point this train has not reached", () => {
  const dir = mkdtempSync(join(tmpdir(), "rail-core-"));
  const db = openDayDb(dir, "2026-10-26");
  db.exec(`
    INSERT INTO td_events (event_id, headcode, area_id, berth, from_berth, msg_type, tiploc, stanox, json, received_at)
    VALUES ('6', '2J68', 'YW', '1234', '0000', 'CA', 'BRLYWJN', '18469', '{"CA_MSG":{"time":"145420","msg_type":"CA"}}', 6)
  `);
  const calls = [{ tiploc: "BRLYWJN", is_passing: 1, wtp: "15:19½", atp: null, etp: "15:23" }];
  const out = overlayTdOnCalls(db, calls, "2J68");
  assert.equal(out[0].atp, null);
  assert.equal(out[0].etp, "15:23");
  db.close();
});

test("overlayTdOnCalls ignores a headcode reused from the morning", () => {
  const dir = mkdtempSync(join(tmpdir(), "rail-core-"));
  const db = openDayDb(dir, "2026-10-20");
  db.exec(`
    INSERT INTO td_events (event_id, headcode, area_id, berth, from_berth, msg_type, tiploc, stanox, json, received_at)
    VALUES ('4', '1M00', 'B2', '1234', '0000', 'CA', 'PROOFHJ', '12345', '{"CA_MSG":{"time":"090715","msg_type":"CA"}}', 4)
  `);
  const calls = [
    { tiploc: "PROOFHJ", is_passing: 1, wtp: "23:25", atp: null },
    { tiploc: "BHAMNWS", is_passing: 0, wta: "23:28" },
  ];
  const out = overlayTdOnCalls(db, calls, "1M00");
  assert.equal(out[0].atp, null);
  db.close();
});

test("overlayTdOnCalls keeps a pass just after midnight", () => {
  const dir = mkdtempSync(join(tmpdir(), "rail-core-"));
  const db = openDayDb(dir, "2026-10-20");
  db.exec(`
    INSERT INTO td_events (event_id, headcode, area_id, berth, from_berth, msg_type, tiploc, stanox, json, received_at)
    VALUES ('5', '1M00', 'B2', '1234', '0000', 'CA', 'PROOFHJ', '12345', '{"CA_MSG":{"time":"001015","msg_type":"CA"}}', 5)
  `);
  const calls = [{ tiploc: "PROOFHJ", is_passing: 1, wtp: "23:50", atp: null }];
  const out = overlayTdOnCalls(db, calls, "1M00");
  assert.equal(out[0].atp, "00:10:15");
  db.close();
});

test("overlayTdOnCalls keeps TD seconds on the same minute", () => {
  const dir = mkdtempSync(join(tmpdir(), "rail-core-"));
  const db = openDayDb(dir, "2026-10-15");
  db.exec(`
    INSERT INTO td_events (event_id, headcode, area_id, berth, from_berth, msg_type, tiploc, stanox, json, received_at)
    VALUES ('3', '9M13', 'Y2', '1234', '0000', 'CA', 'BIRTLEY', '12345', '{"CA_MSG":{"time":"131215","msg_type":"CA"}}', 3)
  `);
  const calls = [
    { tiploc: "BIRTLEY", is_passing: 1, wtp: "13:07", atp: "13:12", actual_source: "trust" },
    { tiploc: "DURHAM", is_passing: 0, atd: "13:13" },
  ];
  const out = overlayTdOnCalls(db, calls, "9M13");
  assert.equal(out[0].atp, "13:12:15");
  assert.equal(out[0].actual_source, "trust");
  assert.equal(out[1].atd, "13:13");
  db.close();
});
