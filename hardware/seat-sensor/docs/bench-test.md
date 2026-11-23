# Seat sensor bench test

This test proves the firmware and the encoder on the bench before anything goes
near the erg.

**You need:** the ESP32-S3 on its terminal carrier, the LPD3806 encoder, a tape
measure, a USB-C data cable, and a Windows PC with VS Code and PlatformIO
(`flashing.md`). Optional: a 20T pulley with about 600 mm of belt, the MC-38
reed and magnet, a USB power meter, and a cordless drill.

**How it runs:** open `../tools/bench.html` in Chrome or Edge. Buttons and live
readings are on the left, and the board's console is on the right. Each button
types its command into the console before it runs, so you see what it did. You
can type the same command yourself in the box under the console. Each step below
gives the **button**, the **command**, and the **pass** criterion. The page marks
most steps pass or check by itself, and fills in a results table you can copy.

If a step fails, fix it before going on. Later steps assume the earlier ones
passed.

## 0. Wire it (power off)

Meter the encoder outputs first. Supply 5 V with nothing else connected:
- If A and B float or only pull low, the outputs are **open collector**, which is
  expected for the LPD3806. Fit the 2.2 kΩ pull-ups below.
- If A and B swing to about 5 V, the outputs are **push-pull**. Don't wire them
  straight to the ESP32. Use a 10 kΩ series and 18 kΩ to 0 V divider on each
  channel instead.

| Field wire | Terminal | Also on that terminal |
|---|---|---|
| Encoder red (V+) | 5V | |
| Encoder black (0 V) | GND | Cable shield, this end only |
| Encoder green (A) | GPIO 4 | 2.2 kΩ to 3V3 |
| Encoder white (B) | GPIO 5 | 2.2 kΩ to 3V3 |
| Reed leg 1 (optional) | GPIO 6 | 4.7 kΩ to 3V3 |
| Reed leg 2 (optional) | GND | |

The colours are the common LPD3806 listing colours, so check them against your
unit's label. Without the reed, still fit the 4.7 kΩ on GPIO 6, and keep a short
jumper on a GND terminal: tapping it onto GPIO 6 stands in for the reed making.

**Pass:** with USB unplugged, measure 3V3 to GPIO 4 and 3V3 to GPIO 5. Each
should read about 2.2 kΩ.

## 1. Flash and connect

Flash with the → Upload button (`flashing.md`, step 2). Close the Serial Monitor
if it's open, then open `bench.html` and click **Connect board (USB)**.

- **Button:** Connect board (USB). It sends `tele on`, which starts telemetry
  lines at 20 Hz, and the board replies with its settings line.
- **Also try:** Show info (`info`), List commands (`help`).
- **Pass (auto):** step 1 shows firmware 0.1.0, protocol 1, scale 40000
  nm/count, direction +1, "woke on: power-on or reset".

> **Try typing it:** click the console box, type `info`, press Enter.

## 2. Counting both ways

Turn the shaft slowly one way, then the other.

- **Watch:** Live → Counts and the 10-second trace.
- **Pass (auto):** the count moves at least 100 each way. A count that sticks, or
  only ever goes up, means A or B isn't reaching its pin. That's a wiring or
  pull-up fault.

Leave **Flip direction** (`dir`) alone on the bench. It gets set on the erg so
that moving away from the flywheel reads positive.

## 3. Ten turns out and back (resolution and lost counts)

This works like an up-scale and down-scale check. Put a tape flag on the shaft and
line it up with a mark on the body.

1. **At the mark**: the page records N0 and sends `pos`.
2. Turn exactly 10 turns one way, slowly, and stop on the mark. Click **After 10
   turns out**.
3. Turn 10 turns back and stop on the mark. Click **After 10 turns back**.

**Pass (auto):** N1 − N0 = ±10 000, within 3 (500 PPR × 2 edges × 10 turns), and N2
− N0 within ±3. An error of hundreds of counts means a channel is dropping edges.
Check the pull-ups and the shield.

> **Try typing it:** `pos` prints the same count the buttons record.

## 4. Speed headroom (optional, drill)

A hard drive on the erg is about 2 m/s. That's 50 rev/s on the 40 mm/rev belt,
and about 25 kHz on channel A. LPD3806 listings quote about 20 kHz maximum, which
is unverified.

1. Line up the flag and click **At the mark, before**.
2. Chuck the shaft lightly in a cordless drill, held in line with no side load,
   and run it in short bursts at increasing speed. Watch **Peak channel A** and
   **max seen** in Live. The bar goes amber above 15 kHz and red above 20 kHz.
3. Line the flag up again by hand and click **At the mark, after**.

**Pass (auto):** the count is back within ±3. A bigger error at high rpm is the
encoder, not the firmware (the PCNT handles far more than 25 kHz). The fix is a 40T
encoder pulley, which halves the frequency and gives 0.08 mm per count.

> **Try typing it:** `rate` prints peak counts/s, Hz and m/s once a second. Type
> `rate` again to stop it.

## 5. Span against the tape (optional, belt)

Fit the 20T pulley with its grub screw on the flat. Lay the belt teeth-up along
the tape on the bench and roll the pulley along it, like a rack and pinion.

1. Hold the pulley at the 100 mm graduation and click **Mark here** (`mark`).
2. Roll to 600 mm, leave the distance at 500, and click **Calculate and save**
   (`span 500`).
3. Do it three times.

**Pass (auto):** all three runs are within ±0.5 % of 40 000 nm/count and agree with
each other within 0.2 %. Belt travel per turn is exactly teeth × pitch, so
nominal is right by design. A consistent offset is more likely belt stretch or
the belt riding off the pulley. If the runs don't agree, click **Back to
nominal** (`cal 40000`).

## 6. Homing logic (jumper or reed)

Live shows the reed state as CLOSED or open, and the HOMED state under the
position.

1. Click **Clear home** (`unhome`). Live shows "not homed".
2. Turn the shaft slowly and, while it's turning, tap the jumper on GPIO 6 or pass
   the magnet over the reed. **Pass:** it becomes HOMED and position reads about
   0. Tick a).
3. With the shaft still, tap again. **Pass:** nothing changes. Tick b).
4. Turn the other way through the spot while you tap. **Pass:** the re-index
   error is unchanged. Tick c).
5. Turn the original way and tap. **Pass:** the re-index error updates. Tick d).
   Its value means nothing on the bench, because your tap isn't at the same shaft
   angle. On the erg it should stay under 1 mm, and the build plan's install test
   checks that.

## 7. Bluetooth

This needs Chrome or Edge on Windows with Bluetooth, or Chrome on Android. Leave
USB connected.

1. Click **Connect Bluetooth** and pick "SplitIQ Seat".
2. The page reads Info, reads and subscribes to Status, then subscribes to Samples.
   The console shows `[ble] samples subscribed` from the board.

**Pass (auto, after about 10 s):** Info bytes are `01 00 01 00 88 13 08 00 40 9C 00
00 00 00`, about 25 packets/s, and every time stamp steps by exactly 40 000 µs
(0 "off"). Turn the shaft: BLE position tracks USB position.

## 8. Sleep and wake

The board stays awake while the page's telemetry is on, and while Bluetooth is
connected.

1. Click **Disconnect Bluetooth**, then **Disconnect board**,
   which sends `tele off`. Leave the shaft still for 5 minutes.
2. Turn the shaft a few degrees, then reconnect. **Pass:** step 1 shows "woke on:
   encoder motion" and Live shows "not homed", because the reference is lost
   through sleep. Tick the first box.
3. Click **Sleep now** (`sleep`), press BOOT on the board, and reconnect.
   **Pass:** "woke on: BOOT button". Tick the second box.
4. Optional, with a USB power meter inline: enter the current while advertising,
   while streaming, and in sleep. The encoder stays powered through sleep, so the
   sleep figure is mostly the encoder. If a power bank switches itself off at
   that current, it won't be there to wake the board. That goes to the build plan.

## Results

The page's **Results** card fills in as you go. **Copy results as a table** puts a
Markdown table on the clipboard, ready to paste into the PR or an issue. Results
are saved in this browser, so a refresh keeps them.
