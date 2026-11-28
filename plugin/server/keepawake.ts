// Keep the PC awake while a project is on vacation. Never throws: a failure means held() is false.
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";

export interface KeepAwake {
  hold(display: boolean): void;
  release(): void;
  held(): boolean;
}

const ES_CONTINUOUS = 0x80000000;
const ES_SYSTEM = 0x1;
const ES_DISPLAY = 0x2;

/** bun:ffi is loaded only here, so other platforms and tests never touch it. */
function kernel32() {
  const { dlopen, FFIType, ptr } = require("bun:ffi") as typeof import("bun:ffi");
  const lib = dlopen("kernel32.dll", {
    SetThreadExecutionState: { args: [FFIType.u32], returns: FFIType.u32 },
    GetSystemPowerStatus: { args: [FFIType.ptr], returns: FFIType.i32 },
  });
  return { ...lib.symbols, ptr };
}

export function isLaptop(platform: string = process.platform): boolean {
  try {
    if (platform === "win32") {
      const k = kernel32();
      const buf = new Uint8Array(12); // SYSTEM_POWER_STATUS: ACLineStatus, BatteryFlag (128 = no battery), ...
      return k.GetSystemPowerStatus(k.ptr(buf)) !== 0 && buf[1] !== 128;
    }
    if (platform === "darwin") return String(spawnSync("pmset", ["-g", "batt"]).stdout).includes("InternalBattery");
    return readdirSync("/sys/class/power_supply").some((n) => n.startsWith("BAT"));
  } catch {
    return false;
  }
}

/** Created on the first hold() only, so a server that never holds never loads ffi or adds an exit listener. */
function windows(): KeepAwake {
  let on = false;
  // ES_CONTINUOUS is per thread: the inbox timer runs on Bun's main JS thread, so hold and release are both called there.
  const set = (flags: number) => kernel32().SetThreadExecutionState(flags) !== 0;
  const w: KeepAwake = {
    hold: (display) => void (on = (() => { try { return set((ES_CONTINUOUS | ES_SYSTEM | (display ? ES_DISPLAY : 0)) >>> 0); } catch { return false; } })()),
    release: () => { try { set(ES_CONTINUOUS); } catch { /* nothing held */ } on = false; },
    held: () => on,
  };
  process.once("exit", w.release);
  return w;
}

/** macOS and Linux hold a sleep inhibitor by keeping a child process alive. */
function child(cmd: string, args: () => string[], run: typeof spawn): KeepAwake {
  let p: ChildProcess | null = null, armed = false;
  const stop = () => { try { p?.kill(); } catch { /* already gone */ } p = null; };
  return {
    hold: (display) => {
      if (p) return;
      try {
        const c = run(cmd, args().concat(display && cmd === "caffeinate" ? ["-d"] : []), { stdio: "ignore" });
        c.on("error", () => { if (p === c) p = null; }).on("exit", () => { if (p === c) p = null; });
        p = c.pid === undefined ? null : c;
        if (p && !armed) { armed = true; process.once("exit", stop); } // once per instance, not per hold
      } catch { p = null; }
    },
    release: stop,
    held: () => p !== null,
  };
}

/** The inhibitor runs a watcher that exits when our pid does, so a SIGKILLed server can't leave the PC held. */
const watch = (pid: number) => `while kill -0 ${pid} 2>/dev/null; do sleep 30; done`;

export function keepAwake(platform: string = process.platform, run: typeof spawn = spawn): KeepAwake {
  let w: KeepAwake | null = null; // lazy, so constructing one never loads ffi
  const win = () => (w ??= windows());
  const inner = platform === "win32"
    ? { hold: (d: boolean) => win().hold(d), release: () => w?.release(), held: () => w?.held() ?? false }
    : platform === "darwin" ? child("caffeinate", () => ["-i", "-w", String(process.pid)], run)
      : child("systemd-inhibit", () => ["--what=sleep", "--why=Away Mode vacation", "sh", "-c", watch(process.pid)], run);
  return inner;
}
