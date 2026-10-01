#!/usr/bin/env node
/**
 * Network Rail Open Data STOMP → ingest-server (local TRUST).
 * Requires `stompit` (`npm i` in rail-core).
 */
import "./load-env.js";
const host = process.env.NR_STOMP_HOST ?? "publicdatafeeds.networkrail.co.uk";
const port = Number(process.env.NR_STOMP_PORT ?? 61618);
const user = process.env.NR_STOMP_USER ?? "";
const pass = process.env.NR_STOMP_PASSWORD ?? "";
const ingest = process.env.INGEST_ORIGIN ?? "http://127.0.0.1:4003";
const useSsl = process.env.NR_STOMP_SSL === "1";

if (!user || !pass) {
  console.error("NR_STOMP_USER/PASSWORD missing");
  process.exit(1);
}

const stompitMod = await import("stompit");
const stompit = stompitMod.default ?? stompitMod;
const connectOptions = {
  host,
  port,
  ssl: useSsl,
  timeout: 30000,
  connectHeaders: {
    host: "/",
    login: user,
    passcode: pass,
    "heart-beat": "15000,15000",
    "accept-version": "1.1",
  },
};

stompit.connect(connectOptions, (err, client) => {
  if (err || !client) {
    console.error(err?.message || String(err));
    process.exit(1);
  }
  const sub = (topic, path) => {
    const headers = { destination: topic, ack: 'auto' }
    client.subscribe(headers, (e, message) => {
      if (e || !message) return
      message.readString('utf-8', async (_e2, body) => {
        if (!body) return
        try {
          await fetch(`${ingest}${path}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: body.startsWith('{') || body.startsWith('[') ? body : JSON.stringify({ raw: body }),
          })
        } catch {
          /* ingest down */
        }
      })
    })
  }
  sub(process.env.NR_RTPPM_TOPIC ?? '/topic/RTPPM_ALL', '/ingest/rtppm')
  sub(process.env.NR_TRUST_TOPIC ?? '/topic/TRAIN_MVT_ALL_TOC', '/ingest/trust')
  console.log('NR STOMP subscribed RTPPM + TRUST')
})
