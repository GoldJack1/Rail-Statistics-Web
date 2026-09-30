#!/usr/bin/env node
/**
 * Always-on PTAC Kafka consumer → ingest /ingest/unit.
 * Runs all day; does not wait for a clock slot.
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

import { gunzipSync } from "node:zlib";

const ingest = process.env.INGEST_ORIGIN ?? "http://127.0.0.1:4003";
const topic = process.env.PTAC_TOPIC || "ptac";
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
const consumer = kafka.consumer({ groupId: process.env.PTAC_GROUP_ID || "rail-core-ptac" });
await consumer.connect();
await consumer.subscribe({ topic, fromBeginning: false });
console.log("PTAC Kafka consumer running", topic);
await consumer.run({
  eachMessage: async ({ message }) => {
    const buf = message.value;
    if (!buf) return;
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
      payload = { raw: text };
    }
    const unitId =
      payload.unit_id ||
      payload.unitId ||
      payload.resourceGroupId ||
      payload.ResourceGroupId ||
      payload.id;
    if (!unitId) return;
    const body = {
      unit_id: String(unitId),
      class: payload.class || payload.fleetId || payload.FleetId || null,
      operator: payload.operator || payload.toc || null,
      rid: payload.rid || payload.RID || null,
      operating_day: payload.operatingDay || payload.operating_day || payload.date || null,
      json: payload,
    };
    try {
      await fetch(`${ingest}/ingest/unit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      /* ingest down */
    }
  },
});
