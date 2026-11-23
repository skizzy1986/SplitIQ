# Flashing the seat sensor: VS Code with buttons and commands side by side

This is the main route: **PlatformIO in plain Windows VS Code, on the PC the board
is plugged into.** The board's USB port then shows up as a normal Windows COM
port, with no WSL, no tunnel and no `usbipd` in the way. (The WSL route is in
Appendix B, for later.)

Every step below gives you three things:

1. **The button** to click.
2. **The command** that button runs. VS Code prints it in the terminal panel, so
   you can read it there too.
3. **What the output means.**

Once a step works with the button, a **Try typing it** box asks you to run the same
thing by hand. Skip those whenever you like. They're there so the commands
become familiar a bit at a time.

## One-off setup (about 20 minutes, mostly downloads)

1. **Install VS Code for Windows** from code.visualstudio.com, if it's not already
   on the PC.
2. **Install the PlatformIO IDE extension.** Open the Extensions sidebar
   (Ctrl+Shift+X), search for `PlatformIO IDE`, and click Install. Restart VS Code
   when it asks. An ant-head icon then appears in the left sidebar.
3. **Get the project onto the Windows side** in a short path with no spaces, for
   example `C:\dev\SplitIQ`. ESP32 toolchains on Windows trip over long paths and
   spaces. If Git for Windows is installed, run this in a Windows terminal
   (PowerShell):

   ```
   git clone https://github.com/skizzy1986/SplitIQ.git C:\dev\SplitIQ
   ```

   Keep this clone separate from your WSL clones, and sync it with
   `git pull` / `git push` like any other clone.
4. **Open only the firmware folder:** File → Open Folder →
   `C:\dev\SplitIQ\hardware\seat-sensor\firmware`. PlatformIO recognises
   `platformio.ini` and sets the project up. The first time, it downloads the
   ESP32 platform and toolchain, which is several hundred MB. The status bar shows
   progress, so let it finish.
5. **Plug the board into its UART port.** The DevKitC-1 has two USB-C ports. Use
   the one labelled **UART** (some clones label it **COM**), not **USB**. Open
   Device Manager → *Ports (COM & LPT)*. A new COM port should appear, for
   example "USB-SERIAL CH343 (COM5)" or "Silicon Labs CP210x (COM5)". If it shows
   with a yellow warning or doesn't appear, install the driver named in it: WCH
   CH343 for most clones, or Silicon Labs CP210x for genuine boards.

## The PlatformIO buttons

They sit in the blue status bar along the bottom of VS Code:

| Button | What it does | Command it runs |
|---|---|---|
| ✓ (tick) | **Build**: compile the firmware | `pio run` |
| → (arrow) | **Upload**: build if needed, then flash the board | `pio run -t upload` |
| 🔌 (plug) | **Serial Monitor**: talk to the board's console | `pio device monitor` |
| 🗑 (bin) | **Clean**: delete the build output | `pio run -t clean` |
| >_ (terminal) | **PlatformIO terminal**: a terminal where `pio` works | — |

**Split view:** drag the terminal panel to the right-hand side of the window
(right-click the panel's title bar → *Move Panel Right*). Your files and the
buttons stay on the left, and the commands and output show on the right.

**Where `pio` works when you type it:** only in a terminal opened with the >_
button, or from the PlatformIO sidebar → *Quick Access → Miscellaneous →
PlatformIO Core CLI*. An ordinary VS Code terminal on Windows doesn't have
`pio` on its PATH, so typing it there gives "not recognised". That's the most
common first stumble.

## Step 1: build

**Button:** ✓ Build.

**Command it runs:** near the top of the terminal output you'll see a line like
`Executing task: C:\Users\…\platformio.exe run`. That is the command.
`platformio` and `pio` are the same program.

**What the output means:**
- `Compiling .pio\build\seat-sensor\src\sensor.cpp.o` means each `.cpp` file is
  being turned into machine code.
- `Linking .pio\build\seat-sensor\firmware.elf` means the pieces are being joined
  into one program.
- `RAM: [=  ] 10.2%` and `Flash: [==  ] 17.8%` show how much of the chip it uses.
  These figures were measured on the draft.
- `[SUCCESS]` means it built. `[FAILED]` means the reason is a few lines above it,
  in a line containing `error:`.

> **Try typing it:** open a PlatformIO terminal (>_), type `pio run` and press
> Enter. The second build is much faster, because only changed files are
> recompiled.

## Step 2: upload (flash)

**Button:** → Upload.

**Command it runs:** `pio run -t upload`. The `-t` means "target": build, then
run the upload target. PlatformIO finds the COM port by itself.

**What the output means:**
- `Auto-detected: COM5` is the port it chose.
- `Connecting....` is esptool asking the chip's bootloader to answer.
- `Writing at 0x00010000... (42 %)` is the firmware being written to flash.
- `Hard resetting via RTS pin...` is the board restarting into the new firmware.
- `[SUCCESS]`.

**If it sticks at `Connecting...`:** hold the board's **BOOT** button, tap
**RESET** (sometimes labelled EN or RST), release BOOT, and click Upload again.
That forces the bootloader by hand. If you see "Access denied" or "port busy",
something else has the COM port open, usually the Serial Monitor or the bench
page. Close it and retry. Only one program can hold a COM port at a time.

> **Try typing it:** `pio run -t upload`.

## Step 3: talk to the board

You have two ways in. Both use the same COM port, so close one before you open
the other.

**A. The bench page (recommended for the bench test).** Open
`hardware\seat-sensor\tools\bench.html` in Chrome or Edge (double-click it in
Explorer). Click **Connect board (USB)** and pick the COM port. The page has
buttons for every test. Its right-hand panel is a console: each button types its
command there first, so you can see exactly what it sent, and you can type your
own commands below it. Procedure: `bench-test.md`.

**B. The Serial Monitor (plain text).**
- **Button:** 🔌 Serial Monitor.
- **Command it runs:** `pio device monitor`. It uses `monitor_speed = 115200`
  from `platformio.ini`, so it talks at 115200 baud.
- **What you see:** press RESET on the board and the banner appears:
  `SplitIQ seat sensor 0.1.0, woke on: power-on or reset. Type 'help'.` Type
  `help` and press Enter to see every command.
- **To leave:** Ctrl+C, or close the terminal tab.

> **Try typing it:** in a PlatformIO terminal, `pio device monitor`, then `info`,
> then `pos`. Turn the encoder shaft and type `pos` again.

**Telemetry lines.** If the bench page was connected last, you may see lines
like `T,1234,500,200,0,0,0,0,0` scrolling. That's machine-readable telemetry
for the page. Type `tele off` to stop it.

## Step 4: check the host tests (optional)

These test the pure maths and the packet layout on the PC, with no board needed.
They need a C++ compiler. VS Code doesn't ship one on Windows, so run them in WSL,
or let the PR's reviewer run them:

```
cd hardware/seat-sensor/firmware
g++ -std=c++17 -Isrc test/host_test.cpp -o seat_test && ./seat_test
```

Expected output: `all host checks passed`.

## Appendix A: the same thing as commands only

From a PlatformIO terminal in the `firmware` folder:

| Do | Command |
|---|---|
| Build | `pio run` |
| Flash | `pio run -t upload` |
| Flash to a named port | `pio run -t upload --upload-port COM5` |
| Console | `pio device monitor` |
| List serial ports | `pio device list` |
| Wipe build output | `pio run -t clean` |
| Wipe the whole chip (also erases saved calibration) | `pio run -t erase` |

## Appendix B: the WSL route (alternative)

WSL has no direct USB access. To flash from WSL, you'd install `usbipd-win` on
Windows and attach the board's COM device to WSL each time you plug it in
(`usbipd attach --wsl --busid <id>`), then run the same `pio` commands inside
WSL against `/dev/ttyUSB0` or `/dev/ttyACM0`. It works, but it adds a
re-attach step on every replug, and it's one more layer to go wrong. Given VS
Code's WSL and tunnel connections have been flaky for you, stay on native
Windows for anything that touches the board. Use WSL for editing and git if you
prefer, and sync through git.
