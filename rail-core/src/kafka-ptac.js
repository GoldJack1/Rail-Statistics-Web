#!/usr/bin/env node
/**
 * Always-on PTAC Kafka consumer → ingest /ingest/unit.
 * Startup seeks back PTAC_INITIAL_REPLAY_MIN (default 48h), matching the old daemon.
 */
const enabled = process.env.PTAC_ENABLED !== "0";
const brokers = (process.env.PTAC_BROKERS || process.env.PTAC_BOOTSTRAP || process.env.DARWIN_PUSH_BROKERS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
if (!enabled || !brokers.length) {
  console.error("PTAC disabled or PTAC_BROKERS/BOOTSTRAP empty");
  process.exit(0);
}

import { writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { parsePtacMessage } from "./parse-ptac.js";

const ingest = process.env.INGEST_ORIGIN ?? "http://127.0.0.1:4003";
const topic = process.env.PTAC_TOPIC || "prod-1033-Passenger-Train-Allocation-and-Consist-1_0";
const replayMin = Math.max(0, Number(process.env.PTAC_INITIAL_REPLAY_MIN || 2880));
const { Kafka } = await import("kafkajs");
const kafka = new Kafka({
  clientId: "rail-core-ptac",
  brokers,
  ssl: true,
  sasl: {
    mechanism: "plain",
    username: process.env.PTAC_USERNAME || process.env.DARWIN_PUSH_USERNAME || "",
    password: process.env.PTAC_PASSWORD || process.env.DARWIN_PUSH_PASSWORD || "",
  },
});
const consumer = kafka.consumer({
  groupId: process.env.PTAC_GROUP_ID || "rail-core-ptac",
  sessionTimeout: Number(process.env.PTAC_SESSION_TIMEOUT_MS || 120_000),
  heartbeatInterval: Number(process.env.PTAC_HEARTBEAT_INTERVAL_MS || 10_000),
  rebalanceTimeout: Number(process.env.PTAC_REBALANCE_TIMEOUT_MS || 90_000),
});
await consumer.connect();
await consumer.subscribe({ topic, fromBeginning: false });

let replayOffsets = null;
if (replayMin > 0) {
  const admin = kafka.admin();
  await admin.connect();
  try {
    replayOffsets = await admin.fetchTopicOffsetsByTimestamp(topic, Date.now() - replayMin * 60_000);
  } catch (err) {
    console.warn("PTAC replay offset fetch failed:", err.message);
  } finally {
    await admin.disconnect();
  }
}

console.log("PTAC Kafka consumer running", topic, replayMin ? `replay ${replayMin} min` : "live only");

let sought = false;
consumer.on(consumer.events.GROUP_JOIN, () => {
  if (sought || !replayOffsets?.length) return;
  sought = true;
  for (const o of replayOffsets) {
    if (o?.offset == null || String(o.offset) === "-1") continue;
    try {
      consumer.seek({ topic, partition: o.partition, offset: String(o.offset) });
    } catch (err) {
      console.warn("PTAC seek failed", o, err.message);
    }
  }
  console.log("PTAC kafka seek applied", replayOffsets.length, "partition(s)", `from ${replayMin} min ago`);
});

const stats = { consumed: 0, posted: 0, skipped: 0, lastSkip: "" };
let dumped = false;
setInterval(() => {
  console.log("PTAC stats", JSON.stringify(stats));
}, 40_000);

await consumer.run({
  eachMessage: async ({ message }) => {
    const buf = message.value;
    if (!buf) return;
    stats.consumed += 1;
    let text;
    try {
      text =
        buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b
          ? gunzipSync(buf).toString("utf8")
          : buf.toString("utf8");
    } catch {
      text = buf.toString("utf8");
    }
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text.trim().startsWith("<") ? text : { raw: text };
    }
    if (!dumped) {
      dumped = true;
      try {
        const sample = typeof payload === "string" ? payload.slice(0, 4000) : JSON.stringify(payload).slice(0, 4000);
        writeFileSync("data/ptac-last.json", sample);
      } catch {
        /* ignore */
      }
    }
    const parsed = parsePtacMessage(payload);
    if (!parsed.unitIds.length) {
      stats.skipped += 1;
      stats.lastSkip = "no-unit";
      return;
    }
    for (const unitId of parsed.unitIds) {
      try {
        const res = await fetch(`${ingest}/ingest/unit`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            unit_id: unitId,
            class: parsed.json?.allocations?.[0]?.resourceGroups?.find((g) => g.unitId === unitId)?.fleetId || null,
            operator: parsed.json?.companyDarwin || parsed.json?.operator || null,
            uid: parsed.uid,
            headcode: parsed.headcode,
            core: parsed.core,
            operating_day: parsed.operatingDay,
            originTpl: parsed.originTpl,
            originHHMM: parsed.originHHMM,
            json: parsed.json,
          }),
        });
        if (res.ok) stats.posted += 1;
        else {
          stats.skipped += 1;
          stats.lastSkip = `http-${res.status}`;
        }
      } catch {
        stats.skipped += 1;
        stats.lastSkip = "ingest-down";
      }
    }
  },
});

