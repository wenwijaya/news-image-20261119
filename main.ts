// The World Today - Thursday 19 November 2026.
// A program that draws one image summing up the day's world news.
// Pure Node 22 stdlib, no network, no clock, no randomness:
// running it twice writes byte-identical PNGs.
//
// Stories (all first reported / happening on 19 Nov 2026):
//   1. GTA VI begins its global rollout after a 13-year wait (AP).
//   2. US and Iran trade blows again; Iran widens attacks to Kuwait and Bahrain.
//   3. Trump, Xi and Putin hold trilateral talks in Shenzhen at the APEC summit.
//   4. EU proposes a 45 billion euro loan for Ukraine.
//   5. NASA marks Voyager 1 one light-day from Earth (16bn miles) with a Nov 19 briefing.
//   6. Cyclone Akvan strengthens off India; landfall expected Friday 20 Nov.
// Also today: Jeffries set to be first Black US House Speaker;
//   Nvidia halts H-series chip shipments to China; Fed minutes point to more rate hikes.

import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";

const W = 1024;
const H = 1024;
const OUT = process.env.OUTPUT_PATH ?? "/output/entry.png";

// ---------------------------------------------------------------------------
// Framebuffer and drawing primitives
// ---------------------------------------------------------------------------

type RGB = [number, number, number];

const NAVY: RGB = [10, 15, 36];
const PANEL: RGB = [20, 29, 56];
const PANEL2: RGB = [24, 36, 65];
const GOLD: RGB = [242, 193, 78];
const RED: RGB = [228, 87, 46];
const TEAL: RGB = [46, 196, 182];
const BLUE: RGB = [74, 124, 255];
const WHITE: RGB = [245, 247, 255];
const MUTED: RGB = [147, 161, 196];
const LINE: RGB = [42, 58, 99];
const DARK: RGB = [8, 11, 26];

const fb = new Uint8Array(W * H * 3);

function put(x: number, y: number, c: RGB): void {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  fb[i] = c[0];
  fb[i + 1] = c[1];
  fb[i + 2] = c[2];
}

function fill(c: RGB): void {
  for (let i = 0; i < W * H; i++) {
    fb[i * 3] = c[0];
    fb[i * 3 + 1] = c[1];
    fb[i * 3 + 2] = c[2];
  }
}

function rect(x: number, y: number, w: number, h: number, c: RGB): void {
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) put(xx, yy, c);
  }
}

function frame(x: number, y: number, w: number, h: number, c: RGB, t: number): void {
  rect(x, y, w, t, c);
  rect(x, y + h - t, w, t, c);
  rect(x, y, t, h, c);
  rect(x + w - t, y, t, h, c);
}

function disc(cx: number, cy: number, r: number, c: RGB): void {
  for (let yy = cy - r; yy <= cy + r; yy++) {
    for (let xx = cx - r; xx <= cx + r; xx++) {
      const dx = xx - cx;
      const dy = yy - cy;
      if (dx * dx + dy * dy <= r * r) put(xx, yy, c);
    }
  }
}

function ring(cx: number, cy: number, r: number, t: number, c: RGB): void {
  for (let yy = cy - r - t; yy <= cy + r + t; yy++) {
    for (let xx = cx - r - t; xx <= cx + r + t; xx++) {
      const d = Math.sqrt((xx - cx) * (xx - cx) + (yy - cy) * (yy - cy));
      if (Math.abs(d - r) <= t / 2) put(xx, yy, c);
    }
  }
}

// Bresenham line.
function line(x0: number, y0: number, x1: number, y1: number, c: RGB): void {
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  for (;;) {
    put(x, y, c);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

// An arc of a circle: angles in degrees, 0 = east, going clockwise (screen y down).
function arc(cx: number, cy: number, r: number, a0: number, a1: number, c: RGB): void {
  for (let a = a0; a <= a1; a += 1) {
    const rad = (a * Math.PI) / 180;
    put(Math.round(cx + r * Math.cos(rad)), Math.round(cy + r * Math.sin(rad)), c);
  }
}

// ---------------------------------------------------------------------------
// 5x7 bitmap font, drawn from scratch for this entry.
// Each glyph is 7 rows of 5 bits ("#" = on).
// ---------------------------------------------------------------------------

const FONT: Record<string, string[]> = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01110", "10001", "10000", "10111", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["01110", "00100", "00100", "00100", "00100", "00100", "01110"],
  J: ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00110", "01000", "10000", "11111"],
  "3": ["11111", "00010", "00100", "00010", "00001", "10001", "01110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
  ".": ["00000", "00000", "00000", "00000", "00000", "01100", "01100"],
  ",": ["00000", "00000", "00000", "00000", "01100", "00100", "01000"],
  ":": ["00000", "01100", "01100", "00000", "01100", "01100", "00000"],
  "'": ["00100", "00100", "01000", "00000", "00000", "00000", "00000"],
  "-": ["00000", "00000", "00000", "01110", "00000", "00000", "00000"],
  "/": ["00001", "00010", "00010", "00100", "01000", "01000", "10000"],
  "(": ["00010", "00100", "01000", "01000", "01000", "00100", "00010"],
  ")": ["01000", "00100", "00010", "00010", "00010", "00100", "01000"],
  "&": ["01100", "10010", "10100", "01000", "10101", "10010", "01101"],
  "!": ["00100", "00100", "00100", "00100", "00100", "00000", "00100"],
  "%": ["11001", "11010", "00010", "00100", "01000", "01011", "10011"],
  "+": ["00000", "00100", "00100", "01110", "00100", "00100", "00000"],
};

function textWidth(s: string, scale: number): number {
  if (s.length === 0) return 0;
  return s.length * 6 * scale - scale;
}

function drawText(s: string, x: number, y: number, scale: number, c: RGB): void {
  let cx = x;
  for (const ch of s) {
    const glyph = FONT[ch] ?? FONT[" "];
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 5; col++) {
        if (glyph[row][col] === "1") {
          rect(cx + col * scale, y + row * scale, scale, scale, c);
        }
      }
    }
    cx += 6 * scale;
  }
}

// Greedy word wrap: returns lines of at most maxChars characters.
function wrap(s: string, maxChars: number): string[] {
  const words = s.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (cur === "") {
      cur = w;
    } else if (cur.length + 1 + w.length <= maxChars) {
      cur += " " + w;
    } else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur !== "") lines.push(cur);
  return lines;
}

// ---------------------------------------------------------------------------
// PNG encoder (stdlib zlib + hand-rolled CRC32 / chunks)
// ---------------------------------------------------------------------------

const CRC_TABLE: number[] = (() => {
  const t: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}

function encodePNG(): Buffer {
  const raw = Buffer.alloc(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 3)] = 0; // filter: none
    raw.set(fb.subarray(y * W * 3, (y + 1) * W * 3), y * (1 + W * 3) + 1);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Icons, drawn with the same primitives (one small picture per story)
// ---------------------------------------------------------------------------

// Hero skyline: Vice City towers with lit windows + a low sun.
function drawSkyline(x0: number, yBase: number, x1: number): void {
  const towers: Array<[number, number, number]> = [
    // [x, width, height]
    [40, 70, 66],
    [122, 54, 96],
    [188, 80, 58],
    [280, 48, 110],
    [340, 66, 76],
    [418, 58, 120],
    [488, 74, 64],
    [562, 50, 92],
    [624, 68, 56],
    [704, 56, 104],
    [772, 72, 70],
    [856, 60, 88],
  ];
  // (No sun: the gold "VI" badge already occupies the hero's right side.)
  for (const [tx, tw, th] of towers) {
    rect(x0 + tx, yBase - th, tw, th, DARK);
    // lit windows: a fixed checkerboard, no randomness
    for (let wy = yBase - th + 10; wy < yBase - 8; wy += 14) {
      for (let wx = x0 + tx + 8; wx < x0 + tx + tw - 8; wx += 14) {
        if (((wx + wy) / 14) % 2 === 0) rect(wx, wy, 5, 6, GOLD);
      }
    }
  }
  rect(x0, yBase - 4, x1 - x0, 4, GOLD);
}

// Radar sweep + missile streak (Gulf).
function drawRadar(cx: number, cy: number): void {
  ring(cx, cy, 34, 3, TEAL);
  ring(cx, cy, 22, 3, TEAL);
  ring(cx, cy, 10, 3, TEAL);
  disc(cx, cy, 3, TEAL);
  line(cx + 34, cy - 34, cx + 62, cy - 62, RED);
  line(cx + 34, cy - 34, cx + 58, cy - 58, RED);
  line(cx + 34, cy - 34, cx + 62, cy - 58, RED);
  disc(cx + 64, cy - 64, 4, RED);
  disc(cx - 30, cy + 28, 3, GOLD);
  disc(cx + 26, cy + 26, 3, GOLD);
}

// Three leaders at one table (diplomacy).
function drawLeaders(cx: number, cy: number): void {
  line(cx - 52, cy + 18, cx + 52, cy + 18, MUTED);
  disc(cx - 52, cy, 20, RED);
  disc(cx, cy - 8, 20, GOLD);
  disc(cx + 52, cy, 20, BLUE);
  drawText("T", cx - 58, cy - 11, 2, WHITE);
  drawText("X", cx - 6, cy - 19, 2, DARK);
  drawText("P", cx + 46, cy - 11, 2, WHITE);
}

// EU circle of stars.
function drawStars(cx: number, cy: number): void {
  disc(cx, cy, 36, BLUE);
  for (let k = 0; k < 12; k++) {
    const a = (k * 30 * Math.PI) / 180 - Math.PI / 2;
    const sx = Math.round(cx + 25 * Math.cos(a));
    const sy = Math.round(cy + 25 * Math.sin(a));
    disc(sx, sy, 3, GOLD);
  }
}

// Voyager: dish + body + dotted trajectory.
function drawVoyager(cx: number, cy: number): void {
  for (let i = 0; i < 7; i++) {
    disc(cx - 72 + i * 13, cy + 40 - i * 11, 3, MUTED);
  }
  line(cx - 10, cy - 8, cx + 34, cy - 34, WHITE);
  line(cx - 10, cy + 14, cx + 34, cy - 34, WHITE);
  line(cx - 10, cy - 8, cx - 10, cy + 14, WHITE);
  line(cx - 9, cy - 7, cx + 33, cy - 33, WHITE);
  line(cx - 9, cy + 13, cx + 33, cy - 33, WHITE);
  arc(cx + 34, cy - 34, 18, 200, 340, GOLD);
  arc(cx + 34, cy - 34, 12, 200, 340, GOLD);
  disc(cx + 2, cy + 3, 5, GOLD);
  disc(cx - 56, cy + 26, 4, TEAL);
}

// Cyclone spiral: nested arcs, tightening toward the eye.
function drawCyclone(cx: number, cy: number): void {
  arc(cx, cy, 34, 20, 300, TEAL);
  arc(cx + 6, cy + 4, 26, 40, 330, TEAL);
  arc(cx + 10, cy + 6, 18, 60, 350, WHITE);
  arc(cx + 12, cy + 6, 11, 90, 20, WHITE);
  disc(cx + 12, cy + 6, 4, GOLD);
  line(cx - 40, cy + 30, cx - 52, cy + 40, MUTED);
  line(cx + 44, cy - 28, cx + 56, cy - 38, MUTED);
}

// ---------------------------------------------------------------------------
// Page layout
// ---------------------------------------------------------------------------

function card(x: number, y: number, w: number, h: number, accent: RGB): void {
  rect(x, y, w, h, PANEL);
  rect(x, y, w, 6, accent);
  frame(x, y, w, h, LINE, 1);
}

// A standard story card: icon, kicker, headline, sub-lines.
function storyCard(
  x: number,
  y: number,
  w: number,
  h: number,
  accent: RGB,
  icon: (cx: number, cy: number) => void,
  kicker: string,
  headline: string,
  sub: string,
): void {
  card(x, y, w, h, accent);
  const cx = x + Math.floor(w / 2);
  icon(cx, y + 58);
  drawText(kicker, x + 18, y + 104, 2, accent);
  const hl = wrap(headline, 15);
  hl.forEach((ln, i) => drawText(ln, x + 18, y + 128 + i * 26, 3, WHITE));
  const subLines = wrap(sub, 23);
  subLines.forEach((ln, i) => drawText(ln, x + 18, y + 190 + i * 16, 2, MUTED));
}

// A wide story card (row 2): icon left, text right.
function wideCard(
  x: number,
  y: number,
  w: number,
  h: number,
  accent: RGB,
  icon: (cx: number, cy: number) => void,
  kicker: string,
  headline: string,
  sub: string,
): void {
  card(x, y, w, h, accent);
  icon(x + 78, y + Math.floor(h / 2));
  const tx = x + 158;
  drawText(kicker, tx, y + 26, 2, accent);
  drawText(headline, tx, y + 52, 3, WHITE);
  const subLines = wrap(sub, 26);
  subLines.forEach((ln, i) => drawText(ln, tx, y + 92 + i * 18, 2, MUTED));
}

function main(): void {
  fill(NAVY);
  // faint vertical bands for depth
  for (let bx = 0; bx < W; bx += 64) rect(bx, 0, 32, H, [12, 18, 42]);

  // ---- Masthead ----
  drawText("THE WORLD TODAY", 32, 30, 6, WHITE);
  drawText("19 NOV 2026", 1024 - 32 - textWidth("19 NOV 2026", 3), 36, 3, GOLD);
  drawText("THURSDAY 19 NOVEMBER 2026 - THE DAY IN ONE PICTURE", 32, 76, 2, MUTED);
  rect(32, 106, 960, 3, GOLD);

  // ---- Hero: GTA VI ----
  const hx = 32;
  const hy = 124;
  const hw = 960;
  const hh = 248;
  rect(hx, hy, hw, hh, PANEL2);
  frame(hx, hy, hw, hh, LINE, 1);
  rect(hx, hy, hw, 6, GOLD);
  drawSkyline(hx, hy + hh, hx + hw);
  drawText("CULTURE - GAMING", hx + 24, hy + 22, 2, GOLD);
  drawText("GTA VI IS HERE", hx + 24, hy + 48, 7, WHITE);
  const heroSub = wrap("AFTER A 13 YEAR WAIT, ROCKSTAR'S VICE CITY SAGA BEGINS ITS GLOBAL ROLLOUT", 52);
  heroSub.forEach((ln, i) => drawText(ln, hx + 24, hy + 108 + i * 18, 2, [220, 228, 245]));
  // "VI" badge
  disc(hx + hw - 84, hy + 66, 46, GOLD);
  ring(hx + hw - 84, hy + 66, 46, 3, WHITE);
  drawText("VI", hx + hw - 84 - textWidth("VI", 6) / 2, hy + 66 - 21, 6, DARK);

  // ---- Row 1: three story cards ----
  storyCard(
    32, 388, 309, 264, RED, drawRadar,
    "MIDDLE EAST",
    "GULF FIRE SPREADS",
    "US AND IRAN TRADE BLOWS AGAIN AS TEHRAN HITS KUWAIT AND BAHRAIN",
  );
  storyCard(
    357, 388, 309, 264, GOLD, drawLeaders,
    "DIPLOMACY",
    "THREE LEADERS, ONE TABLE",
    "TRUMP, XI AND PUTIN MEET IN SHENZHEN AT THE APEC SUMMIT",
  );
  storyCard(
    682, 388, 309, 264, BLUE, drawStars,
    "EUROPE",
    "EU: 45BN FOR KYIV",
    "BRUSSELS PROPOSES A 45 BILLION EURO LOAN FOR UKRAINE",
  );

  // ---- Row 2: two wide cards ----
  wideCard(
    32, 668, 471, 216, TEAL, drawVoyager,
    "SPACE",
    "ONE LIGHT-DAY OUT",
    "NASA MARKS VOYAGER 1, NOW 16 BILLION MILES FROM HOME, AFTER 49 YEARS IN FLIGHT",
  );
  wideCard(
    521, 668, 471, 216, TEAL, drawCyclone,
    "WEATHER",
    "AKVAN BEARS DOWN",
    "CYCLONE AKVAN STRENGTHENS OFF INDIA, LANDFALL EXPECTED FRIDAY",
  );

  // ---- Also-today ticker ----
  rect(32, 900, 960, 68, PANEL);
  frame(32, 900, 960, 68, LINE, 1);
  drawText("ALSO TODAY: JEFFRIES SET TO BE FIRST BLACK US HOUSE SPEAKER", 48, 914, 2, WHITE);
  drawText("NVIDIA HALTS H-SERIES CHIPS TO CHINA - FED EYES MORE RATE HIKES", 48, 938, 2, MUTED);

  // ---- Footer ----
  drawText("SOURCES: AP, REUTERS, NASA, EUROPEAN COMMISSION, IMD - DRAWN ENTIRELY IN CODE", 32, 986, 2, MUTED);

  const png = encodePNG();
  const dir = path.dirname(OUT);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(OUT, png);
  // Also drop a local copy next to the program for inspection.
  fs.writeFileSync(path.join(process.cwd(), "entry.png"), png);
  console.log(`wrote ${OUT} (${png.length} bytes, ${W}x${H})`);
}

main();
