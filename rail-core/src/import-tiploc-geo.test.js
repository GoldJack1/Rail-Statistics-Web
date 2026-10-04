import { test } from "node:test";
import assert from "node:assert/strict";
import { parseGeoFile, rowToGeo } from "./import-tiploc-geo.js";
import { osgbToWgs84 } from "./osgb.js";

test("rowToGeo reads YA merged stop_id tipocs", () => {
  const g = rowToGeo({
    stop_id: "DYCLJN",
    stop_lat: "53.7088",
    stop_lon: "-1.8552",
    easting: "409655",
    northing: "423609",
    stop_url: "woodpecker",
  });
  assert.equal(g.tiploc, "DYCLJN");
  assert.ok(Math.abs(g.lat - 53.7088) < 1e-6);
});

test("rowToGeo strips NaPTAN 9100 prefix", () => {
  const g = rowToGeo({
    stop_id: "9100BATLEY",
    stop_lat: "53.71",
    stop_lon: "-1.62",
  });
  assert.equal(g.tiploc, "BATLEY");
});

test("rowToGeo converts easting/northing when lat/lon missing", () => {
  const g = rowToGeo({
    TiplocCode: "TESTJN",
    Easting: "429870",
    Northing: "433350",
  });
  assert.equal(g.tiploc, "TESTJN");
  assert.ok(g.lat > 53.7 && g.lat < 53.9);
  assert.ok(g.lon > -1.7 && g.lon < -1.4);
});

test("osgbToWgs84 returns Leeds-area coords", () => {
  const wgs = osgbToWgs84(429870, 433350);
  assert.ok(wgs);
  assert.ok(wgs.lat > 53.7 && wgs.lat < 53.9);
});

test("parseGeoFile skips junk", () => {
  const rows = parseGeoFile(
    `stop_id,stop_lat,stop_lon\nLEEDS,53.79,-1.54\nBAD,,\n`,
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].tiploc, "LEEDS");
});
