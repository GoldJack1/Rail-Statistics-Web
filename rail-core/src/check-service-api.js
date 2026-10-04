#!/usr/bin/env node
import "./load-env.js";

const port = process.env.QUERY_PORT || 4001;
const rid = process.argv[2] || "202610047116005";
const res = await fetch(`http://127.0.0.1:${port}/service/${rid}`);
if (!res.ok) {
  console.error("status", res.status);
  process.exit(1);
}
const j = await res.json();
const tips = (j.stops || []).map((s) => s.tpl);
console.log(
  JSON.stringify(
    {
      holbeck: tips.includes("HOLBJCN"),
      mirfield: tips.includes("MIRFILD"),
      sowerby: tips.includes("SWRBBDG"),
      legMiles: (j.stops || []).filter((s) => s.legMiles != null).length,
      td: j.td || null,
      sample: (j.stops || [])
        .filter((s) => ["WHRDJN", "HOLBJCN", "COTNGLY"].includes(s.tpl))
        .map((s) => ({ tpl: s.tpl, legMiles: s.legMiles, cumMiles: s.cumMiles })),
    },
    null,
    2,
  ),
);
