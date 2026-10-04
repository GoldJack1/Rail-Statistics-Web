#!/usr/bin/env node
/**
 * Network Rail Open Data STOMP → ingest-server.
 * TRUST movements, VSTP schedules, TD berths, RTPPM.
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
  const sub = (topic, path, enabled = true) => {
    if (!enabled || !topic) return;
    const headers = { destination: topic, ack: "auto" };
    client.subscribe(headers, (e, message) => {
      if (e || !message) return;
      message.readString("utf-8", async (_e2, body) => {
        if (!body) return;
        try {
          await fetch(`${ingest}${path}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: body.startsWith("{") || body.startsWith("[") ? body : JSON.stringify({ raw: body }),
          });
        } catch {
          /* ingest down */
        }
      });
    });
  };

  const trustOn = process.env.NR_TRUST !== "0";
  const vstpOn = process.env.NR_VSTP !== "0";
  const tdOn = process.env.NR_TD !== "0";
  const rtppmOn = process.env.NR_RTPPM !== "0";

  sub(process.env.NR_TRUST_TOPIC ?? "/topic/TRAIN_MVT_ALL_TOC", "/ingest/trust", trustOn);
  sub(process.env.NR_VSTP_TOPIC ?? "/topic/VSTP_ALL", "/ingest/vstp", vstpOn);
  sub(process.env.NR_TD_TOPIC ?? "/topic/TD_ALL_SIG_AREA", "/ingest/td", tdOn);
  sub(process.env.NR_RTPPM_TOPIC ?? "/topic/RTPPM_ALL", "/ingest/rtppm", rtppmOn);

  console.log(
    "NR STOMP subscribed",
    [
      trustOn ? "TRUST" : null,
      vstpOn ? "VSTP" : null,
      tdOn ? "TD" : null,
      rtppmOn ? "RTPPM" : null,
    ]
      .filter(Boolean)
      .join(" + "),
  );
});
