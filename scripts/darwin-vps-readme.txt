Darwin VPS helper
=================

Do not put passwords in this file.


SSH (Mac)
---------

ssh root@159.195.214.118

Then on the box you can run darwin-vps … (see below). Type exit to leave.


Cockpit GUI (already installed)
-------------------------------

Cockpit listens only on the VPS at 127.0.0.1:9090. It is not meant to be
opened as https://159.195.214.118:9090/

1. On the Mac, leave this Terminal window open:

ssh -N -L 9090:127.0.0.1:9090 root@159.195.214.118

2. Browser: http://127.0.0.1:9090

3. Log in as user darwin (not root). Debian blocks root in Cockpit.

Ctrl+C in that Terminal window closes the tunnel.

If login says Permission denied for root:

sed -i '/^root$/d' /etc/cockpit/disallowed-users

Prefer logging in as darwin. If darwin has no password yet (as root):

passwd darwin

If the tunnel says Connection refused, Cockpit is not listening. As root:

systemctl enable --now cockpit.socket
systemctl restart cockpit.socket
ss -tlnp | grep 9090

You must see 127.0.0.1:9090 then run the Mac tunnel again.


darwin-vps (on the VPS after SSH)
---------------------------------

darwin-vps status
darwin-vps logs 200
darwin-vps follow
darwin-vps restart
darwin-vps health
darwin-vps data
darwin-vps fetch
darwin-vps start
darwin-vps stop
darwin-vps reboot

The Mac ./scripts/darwin-vps.sh helper needed an extra SSH key that was
removed, so those Mac one-liners do not work. Use SSH + darwin-vps, or Cockpit.


Overnight (timetables)
----------------------

Yes — new PPTimetable files should arrive overnight without you doing anything,
as long as the darwin systemd service stays running.

- Daemon auto-fetch: about 04:00 Europe/London, retries until about 04:35
  until today’s v8 file is in GCS.
- Backup cron: 04:10 as user darwin (fetch-daily-timetables.mjs).
- Files land in /home/darwin/darwin-local-test/tt/<YYYYMMDD>/
- GCS often only has today (and maybe yesterday) until the morning drop.
  “no v8 object for tomorrow” during the evening is normal.

Live boards / units / bash do not wait overnight: Kafka keeps running all day
if darwin is active. The website on Netlify is separate; it is not updated by
this VPS cron.

Check in the morning: darwin-vps logs 200  (look for auto-fetch)
or darwin-vps fetch  (safe; skips files already on disk)


What each darwin-vps command does
---------------------------------

status   Snapshot: darwin running, Caddy, RAM, disk, local ping. No changes.
logs     Last 80 journal lines (or logs 200). Prints then exits.
follow   Live log tail until Ctrl+C.
start    Start darwin if stopped. Does not reboot the VPS.
stop     Stop darwin only. API data fails until start. Box stays on.
restart  Bounce darwin. Short API outage. Prefer this over reboot.
health   /api/ping and a short /api/health on the box. Not Netlify.
data     Read-only disk, history days, unit-catalog days. Deletes nothing.
fetch    Download PPTimetable from GCS now into tt/<day>/.
reboot   Reboot the whole VPS after typing yes. Prefer restart for Darwin.
