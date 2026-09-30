/**
 * Worker half of the hero ASCII field: owns the OffscreenCanvas the page
 * transferred, so the whole frame loop runs off the main thread and can never
 * cost the page a scroll frame. The page sends `run` on/off as the hero enters
 * and leaves the viewport or the tab is hidden.
 */
import { createField, type Field, type RGB } from "./field";

type Msg =
  | { type: "init"; canvas: OffscreenCanvas; width: number; height: number; dpr: number; base: RGB; peak: RGB; fps: number; still: boolean }
  | { type: "resize"; width: number; height: number }
  | { type: "run"; on: boolean };

// Typed by hand: the project compiles against the DOM lib, not "webworker".
const scope = self as unknown as {
  setTimeout: (fn: () => void, ms: number) => number;
  clearTimeout: (id: number) => void;
  onmessage: ((e: MessageEvent<Msg>) => void) | null;
};

let field: Field | null = null;
let frameMs = 1000 / 24;
let still = false;
let running = false;
let timer = 0;
let frame = 0;
let last = 0;

function loop() {
  if (!running || !field) return;
  const now = performance.now();
  if (now - last >= frameMs - 1) {
    last = now;
    field.paint(frame);
    frame += 1.4 * (frameMs / (1000 / 24)); // same wave speed at any fps
  }
  timer = scope.setTimeout(loop, Math.max(4, frameMs - (performance.now() - now)));
}

function setRunning(on: boolean) {
  if (still) return;
  if (on === running) return;
  running = on;
  scope.clearTimeout(timer);
  if (on) loop();
}

scope.onmessage = (e: MessageEvent<Msg>) => {
  const m = e.data;
  if (m.type === "init") {
    frameMs = 1000 / m.fps;
    still = m.still;
    field = createField(m.canvas, (w, h) => new OffscreenCanvas(w, h), { dpr: m.dpr, base: m.base, peak: m.peak });
    field?.resize(m.width, m.height);
    field?.paint(frame);
  } else if (m.type === "resize") {
    field?.resize(m.width, m.height);
    field?.paint(frame);
  } else if (m.type === "run") {
    setRunning(m.on);
  }
};
