#!/usr/bin/env node
/**
 * Optional Darwin Kafka loop. Requires kafkajs and env from .env.example.
 * Posts XML to ingest-server (change detection happens there).
 */
const brokers = (process.env.DARWIN_PUSH_BROKERS ?? "").split(",").filter(Boolean);
if (!brokers.length) {
  console.error("DARWIN_PUSH_BROKERS empty — not starting consumer");
  process.exit(0);
}

import { gunzipSync } from "node:zlib";

const ingest = process.env.INGEST_URL ?? "http://127.0.0.1:4003/ingest/darwin";

const { Kafka } = await import("kafkajs");
const kafka = new Kafka({
  clientId: "rail-core",
  brokers,
  ssl: true,
  sasl: {
    mechanism: "plain",
    username: process.env.DARWIN_PUSH_USERNAME ?? "",
    password: process.env.DARWIN_PUSH_PASSWORD ?? "",
  },
});
const consumer = kafka.consumer({ groupId: process.env.DARWIN_PUSH_CONSUMER_GROUP ?? "rail-core" });
await consumer.connect();
await consumer.subscribe({ topic: process.env.DARWIN_PUSH_TOPIC ?? "darwin.xml", fromBeginning: false });
console.log("Darwin Kafka consumer running");
await consumer.run({
  eachMessage: async ({ message }) => {
    const buf = message.value;
    if (!buf) return;
    let xml;
    try {
      xml =
        buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b
          ? gunzipSync(buf).toString("utf8")
          : buf.toString("utf8");
    } catch {
      xml = buf.toString("utf8");
    }
    await fetch(ingest, { method: "POST", headers: { "content-type": "application/xml" }, body: xml }).then(async (res) => {
      if (!res.ok && res.status !== 200) {
        const t = await res.text();
        if (t.includes("unparsed")) console.error("unparsed", t.slice(0, 200));
      }
    });
  },
});
