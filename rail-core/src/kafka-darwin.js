#!/usr/bin/env node
/**
 * Darwin Push Port Kafka → POST /ingest/darwin (JSON or gzip XML).
 */
const brokers = (process.env.DARWIN_PUSH_BROKERS ?? "").split(",").filter(Boolean);
if (!brokers.length) {
  console.error("DARWIN_PUSH_BROKERS empty — not starting consumer");
  process.exit(0);
}

import { gunzipSync } from "node:zlib";

const ingest = process.env.INGEST_URL ?? "http://127.0.0.1:4003/ingest/darwin";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Ingest restarts for a few seconds. A thrown TypeError is fatal to KafkaJS, so retry here. */
async function postDarwin(xml) {
  const waits = [250, 500, 1000, 2000, 4000, 8000];
  let last;
  for (let attempt = 0; attempt <= waits.length; attempt++) {
    try {
      const res = await fetch(ingest, {
        method: "POST",
        headers: { "content-type": "application/xml" },
        body: xml,
      });
      const t = await res.text();
      if (res.ok) return;
      if (res.status < 500 && res.status !== 408 && res.status !== 429) {
        if (t.includes("unparsed")) console.error("unparsed", t.slice(0, 240));
        return;
      }
      last = new Error(`ingest ${res.status}`);
    } catch (err) {
      last = err;
    }
    if (attempt < waits.length) await sleep(waits[attempt]);
  }
  const wrapped = new Error(`ingest unavailable: ${last?.message || last}`);
  wrapped.retriable = true;
  throw wrapped;
}

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
    await postDarwin(xml);
  },
});
