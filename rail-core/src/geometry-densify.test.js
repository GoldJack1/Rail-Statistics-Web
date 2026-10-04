import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildGeoIndex,
  corridorMids,
  densifyCallsWithGeometry,
  distToSegmentM,
  haversineM,
  isNonPassengerLocation,
} from "./geometry-densify.js";

/** Real-ish coords from tiplocs-merged (OSGB corridor tests). */
const GEO = buildGeoIndex([
  { tiploc: "MLNRYDJ", lat: 53.7079051225884, lon: -1.9075532105565427 },
  { tiploc: "DYCLJN", lat: 53.70883350018099, lon: -1.8552150230758473 },
  { tiploc: "HLFX", lat: 53.7205, lon: -1.854 },
  { tiploc: "GRTLNDJ", lat: 53.69381942180738, lon: -1.8575777425575442 },
  { tiploc: "ELLAND", lat: 53.6907538930783, lon: -1.837932233045727 },
  { tiploc: "BRHOUSE", lat: 53.69819729483, lon: -1.77943883658 },
  { tiploc: "HDRSFLD", lat: 53.648, lon: -1.785 },
  { tiploc: "DWBY", lat: 53.692, lon: -1.632 },
  { tiploc: "BATLEY", lat: 53.70994134066, lon: -1.6229524536 },
  { tiploc: "MRLY", lat: 53.748, lon: -1.59 },
  { tiploc: "COTNGLY", lat: 53.76781663135, lon: -1.58770804242 },
  { tiploc: "HOLBJCN", lat: 53.79147276500948, lon: -1.5683594121397348 },
  { tiploc: "WHRDJN", lat: 53.792, lon: -1.56 },
  { tiploc: "YORK", lat: 53.95796588375, lon: -1.09318208959 },
  { tiploc: "POPLTON", lat: 53.9758978522, lon: -1.14859660402 },
  { tiploc: "SKELTON", lat: 53.978, lon: -1.1 },
]);

const STATIONS = new Set([
  "ELLAND",
  "BRHOUSE",
  "BATLEY",
  "COTNGLY",
  "POPLTON",
  "HDRSFLD",
  "HLFX",
  "DWBY",
  "MRLY",
  "WHTRSE",
  "ARDWICK",
  "LVHM",
  "MLDTHRD",
  "BAGE",
  "EDIDBRY",
  "GATLEY",
  "MIRFILD",
  "SWRBBDG",
  "REDCBSC",
]);

test("haversine and segment distance are sane", () => {
  const a = GEO.byTpl.get("MLNRYDJ");
  const b = GEO.byTpl.get("GRTLNDJ");
  assert.ok(haversineM(a, b) > 2000);
  const d = distToSegmentM(GEO.byTpl.get("DYCLJN"), a, b);
  assert.ok(d.offsetM > 1000);
});

test("Dryclough is rejected between Milner Royd and Greetland", () => {
  const validated = new Map([["MLNRYDJ\tGRTLNDJ", new Set(["DYCLJN", "HLFX"])]]);
  const mids = corridorMids(GEO, "MLNRYDJ", "GRTLNDJ", {
    stationCrs: STATIONS,
    validatedMids: validated,
  });
  assert.ok(!mids.includes("DYCLJN"));
  assert.ok(!mids.includes("HLFX"));
});

test("Elland is out without validation (no free CRS densify)", () => {
  const mids = corridorMids(GEO, "GRTLNDJ", "BRHOUSE", { stationCrs: STATIONS });
  assert.ok(!mids.includes("ELLAND"));
});

test("Elland is in when ITPS-validated for the pair", () => {
  const mids = corridorMids(GEO, "GRTLNDJ", "BRHOUSE", {
    stationCrs: STATIONS,
    validatedMids: new Map([["GRTLNDJ\tBRHOUSE", new Set(["ELLAND"])]]),
  });
  assert.ok(mids.includes("ELLAND"));
  assert.ok(!mids.includes("HDRSFLD"));
});

test("Batley and Cottingley require validation (CRS)", () => {
  const idx = buildGeoIndex([
    { tiploc: "DWBY", lat: 53.692077, lon: -1.633126 },
    { tiploc: "BATLEY", lat: 53.70994134066, lon: -1.6229524536 },
    { tiploc: "MRLY", lat: 53.7495, lon: -1.595 },
    { tiploc: "COTNGLY", lat: 53.76781663135, lon: -1.58770804242 },
    { tiploc: "WHRDJN", lat: 53.795, lon: -1.555 },
  ]);
  assert.deepEqual(corridorMids(idx, "DWBY", "MRLY", { stationCrs: STATIONS }), []);
  assert.deepEqual(
    corridorMids(idx, "DWBY", "MRLY", {
      stationCrs: STATIONS,
      validatedMids: new Map([["DWBY\tMRLY", new Set(["BATLEY"])]]),
    }),
    ["BATLEY"],
  );
  const leedsApproach = corridorMids(idx, "MRLY", "WHRDJN", {
    stationCrs: STATIONS,
    validatedMids: new Map([["MRLY\tWHRDJN", new Set(["COTNGLY"])]]),
  });
  assert.ok(leedsApproach.includes("COTNGLY"));
});

test("Poppleton is rejected between York and Skelton", () => {
  const mids = corridorMids(GEO, "YORK", "SKELTON", { stationCrs: STATIONS });
  assert.ok(!mids.includes("POPLTON"));
});

test("tight non-CRS invent removed — junction needs ITPS validation", () => {
  const idx = buildGeoIndex([
    { tiploc: "A", lat: 53.7, lon: -1.9 },
    { tiploc: "MIDJN", lat: 53.705, lon: -1.875 },
    { tiploc: "B", lat: 53.71, lon: -1.85 },
  ]);
  const a = idx.byTpl.get("A");
  const b = idx.byTpl.get("B");
  const off = distToSegmentM(idx.byTpl.get("MIDJN"), a, b).offsetM;
  assert.ok(off <= 200, `offset ${off}`);
  assert.deepEqual(corridorMids(idx, "A", "B", { stationCrs: new Set() }), []);
  assert.deepEqual(
    corridorMids(idx, "A", "B", {
      stationCrs: new Set(),
      validatedMids: new Map([["A\tB", new Set(["MIDJN"])]]),
    }),
    ["MIDJN"],
  );
});

test("far non-CRS Picton stays out even when validated (offset > 750 m)", () => {
  const idx = buildGeoIndex([
    { tiploc: "YAAM", lat: 54.493, lon: -1.351 },
    { tiploc: "PICTON", lat: 54.4647, lon: -1.3491 },
    { tiploc: "NLRTEJN", lat: 54.338, lon: -1.428 },
  ]);
  assert.ok(!corridorMids(idx, "YAAM", "NLRTEJN", { stationCrs: new Set() }).includes("PICTON"));
  assert.ok(
    !corridorMids(idx, "YAAM", "NLRTEJN", {
      stationCrs: new Set(),
      validatedMids: new Map([["YAAM\tNLRTEJN", new Set(["PICTON"])]]),
    }).includes("PICTON"),
  );
});

test("non-passenger locations are rejected", () => {
  assert.equal(isNonPassengerLocation("MNCRNBM", { name: "Newbold Metrolink", crs: "NBM" }), true);
  assert.equal(isNonPassengerLocation("NEVLTMD", { name: "Neville Hill T&R.S.M.D", crs: "XNL" }), true);
  assert.equal(isNonPassengerLocation("TEESY", { name: "Tees N.Y.", crs: "" }), true);
  assert.equal(isNonPassengerLocation("ELLAND", { name: "Elland", crs: "ELN" }), false);
});

test("airport: Levenshulme/White Rose/Ardwick out; Mauldeth in when validated", () => {
  const idx = buildGeoIndex([
    { tiploc: "SLDLJN", lat: 53.4465, lon: -2.2005 },
    { tiploc: "LVHM", lat: 53.44416288157, lon: -2.19266965586 },
    { tiploc: "MLDTHRD", lat: 53.43306110246, lon: -2.20925122444 },
    { tiploc: "BAGE", lat: 53.42117, lon: -2.21568 },
    { tiploc: "EDIDBRY", lat: 53.40931, lon: -2.222 },
    { tiploc: "GATLEY", lat: 53.3928, lon: -2.2307 },
    { tiploc: "COTNGLY", lat: 53.76781663135, lon: -1.58770804242 },
    { tiploc: "WHTRSE", lat: 53.762, lon: -1.5828 },
    { tiploc: "MRLY", lat: 53.7495, lon: -1.595 },
    { tiploc: "ARDWCKJ", lat: 53.472, lon: -2.215 },
    { tiploc: "ARDWICK", lat: 53.4712, lon: -2.2135 },
  ]);
  const stations = new Set(["LVHM", "MLDTHRD", "BAGE", "EDIDBRY", "GATLEY", "WHTRSE", "ARDWICK", "COTNGLY", "MRLY"]);
  assert.ok(!corridorMids(idx, "SLDLJN", "GATLEY", { stationCrs: stations }).includes("LVHM"));
  assert.ok(!corridorMids(idx, "COTNGLY", "MRLY", { stationCrs: stations }).includes("WHTRSE"));
  assert.ok(!corridorMids(idx, "ARDWCKJ", "SLDLJN", { stationCrs: stations }).includes("ARDWICK"));
  const styal = corridorMids(idx, "SLDLJN", "GATLEY", {
    stationCrs: stations,
    // Airport WTTs validate Styal stations, not Stockport-line Levenshulme.
    validatedMids: new Map([["SLDLJN\tGATLEY", new Set(["MLDTHRD", "BAGE", "EDIDBRY"])]]),
  });
  assert.ok(styal.includes("MLDTHRD"));
  assert.ok(styal.includes("BAGE"));
  assert.ok(!styal.includes("LVHM"));
});

test("Levenshulme is out without free CRS densify", () => {
  const idx = buildGeoIndex([
    { tiploc: "SLDLJN", lat: 53.4465, lon: -2.2005 },
    { tiploc: "LVHM", lat: 53.44416288157, lon: -2.19266965586 },
    { tiploc: "GATLEY", lat: 53.3928, lon: -2.2307 },
  ]);
  assert.ok(
    !corridorMids(idx, "SLDLJN", "GATLEY", { stationCrs: new Set(["LVHM", "GATLEY"]) }).includes(
      "LVHM",
    ),
  );
});

test("Tees: non-CRS junctions need validation (tight invent removed)", () => {
  const idx = buildGeoIndex([
    { tiploc: "GRTNSHJ", lat: 54.59756485540085, lon: -1.136006454058013 },
    { tiploc: "GRTNJN", lat: 54.5926, lon: -1.1441 },
    { tiploc: "GRTN", lat: 54.59125, lon: -1.1463 },
    { tiploc: "STHBANK", lat: 54.584, lon: -1.15 },
    { tiploc: "STHBNKJ", lat: 54.581, lon: -1.155 },
    { tiploc: "WHTEHSJ", lat: 54.575, lon: -1.165 },
  ]);
  assert.ok(
    !corridorMids(idx, "GRTNSHJ", "GRTN", { stationCrs: new Set(["STHBANK"]) }).includes("GRTNJN"),
  );
  assert.ok(
    corridorMids(idx, "GRTNSHJ", "GRTN", {
      stationCrs: new Set(["STHBANK"]),
      validatedMids: new Map([["GRTNSHJ\tGRTN", new Set(["GRTNJN"])]]),
    }).includes("GRTNJN"),
  );
  assert.ok(
    corridorMids(idx, "STHBANK", "WHTEHSJ", {
      stationCrs: new Set(["STHBANK"]),
      validatedMids: new Map([["STHBANK\tWHTEHSJ", new Set(["STHBNKJ"])]]),
    }).includes("STHBNKJ"),
  );
});

test("Mirfield / Sowerby near-endpoint validated CRS inserts", () => {
  const idx = buildGeoIndex([
    { tiploc: "MIRFEJN", lat: 53.67175, lon: -1.6918 },
    { tiploc: "MIRFILD", lat: 53.6714, lon: -1.6925 },
    { tiploc: "HETNLJN", lat: 53.6769, lon: -1.7106 },
    { tiploc: "MLNRYDJ", lat: 53.7079051225884, lon: -1.9075532105565427 },
    // ~40 m east of Milner Royd toward Hebden Bridge
    { tiploc: "SWRBBDG", lat: 53.7081, lon: -1.9069 },
    { tiploc: "HBDNBDG", lat: 53.7375, lon: -2.045 },
  ]);
  const mirfield = corridorMids(idx, "MIRFEJN", "HETNLJN", {
    stationCrs: STATIONS,
    validatedMids: new Map([["MIRFEJN\tHETNLJN", new Set(["MIRFILD"])]]),
  });
  assert.ok(mirfield.includes("MIRFILD"));
  const sowerby = corridorMids(idx, "MLNRYDJ", "HBDNBDG", {
    stationCrs: STATIONS,
    validatedMids: new Map([["MLNRYDJ\tHBDNBDG", new Set(["SWRBBDG"])]]),
  });
  assert.ok(sowerby.includes("SWRBBDG"));
});

test("densifyCallsWithGeometry second pass and validated Elland", () => {
  const { calls, inserted } = densifyCallsWithGeometry(
    [
      { tiploc: "GRTLNDJ", wtp: "16:28", is_passing: 1 },
      { tiploc: "BRHOUSE", sta: "16:32", std: "16:33", is_passing: 0 },
    ],
    GEO,
    {
      stationCrs: STATIONS,
      validatedMids: new Map([["GRTLNDJ\tBRHOUSE", new Set(["ELLAND"])]]),
      passes: 2,
    },
  );
  assert.ok(inserted >= 1);
  assert.equal(calls[0].tiploc, "GRTLNDJ");
  assert.equal(calls[calls.length - 1].tiploc, "BRHOUSE");
  assert.ok(calls.some((c) => c.tiploc === "ELLAND" && c.geomPass));
});

test("densify without validation does not invent Elland", () => {
  const { inserted, calls } = densifyCallsWithGeometry(
    [
      { tiploc: "GRTLNDJ", wtp: "16:28", is_passing: 1 },
      { tiploc: "BRHOUSE", sta: "16:32", std: "16:33", is_passing: 0 },
    ],
    GEO,
    { stationCrs: STATIONS, passes: 2 },
  );
  assert.equal(inserted, 0);
  assert.ok(!calls.some((c) => c.tiploc === "ELLAND"));
});
