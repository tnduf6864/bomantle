import { Jimp } from "jimp";
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = "D:/보맨틀";
const games = JSON.parse(
  await fs.readFile(path.join(ROOT, "workers/api/src/games.json"), "utf8"),
);
const OUT = path.join(ROOT, "apps/web/public/boxart");
await fs.mkdir(OUT, { recursive: true });

// answer.ts buildAnswerPool 로직 복제 (정답이 될 수 있는 풀만 다운로드)
function baseName(g) {
  const n = g.name_ko ?? g.name_en ?? String(g.id);
  return n.split(/[:\-(]/)[0].trim();
}
const eligible = games.filter(
  (g) =>
    g.rank != null &&
    g.weight != null &&
    (g.categories?.length ?? 0) >= 2 &&
    g.players_min != null &&
    (g.review_count ?? 0) >= 50,
);
const best = new Map();
for (const g of eligible) {
  const k = baseName(g);
  const c = best.get(k);
  if (!c || (g.rank ?? 1e9) < (c.rank ?? 1e9)) best.set(k, g);
}
const pool = [...best.values()]
  .sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9))
  .slice(0, 1200);
const targets = pool.filter((g) => g.image);
console.log("pool", pool.length, "withImage", targets.length);

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const ok = [];
const fail = [];
let i = 0;
const CONC = 8;

async function worker() {
  while (i < targets.length) {
    const g = targets[i++];
    const dest = path.join(OUT, g.id + ".jpg");
    try {
      let buf = null;
      for (let a = 0; a < 3; a++) {
        try {
          const r = await fetch(g.image, {
            headers: {
              "User-Agent": UA,
              Referer: "https://boardlife.co.kr/",
              Accept: "image/avif,image/webp,image/*,*/*;q=0.8",
            },
          });
          if (!r.ok) throw new Error("status " + r.status);
          buf = Buffer.from(await r.arrayBuffer());
          break;
        } catch (e) {
          if (a === 2) throw e;
          await new Promise((s) => setTimeout(s, 600 * (a + 1)));
        }
      }
      const img = await Jimp.read(buf);
      img.scaleToFit({ w: 320, h: 320 });
      const out = await img.getBuffer("image/jpeg", { quality: 80 });
      await fs.writeFile(dest, out);
      ok.push(g.id);
      if (ok.length % 50 === 0) console.log("downloaded", ok.length, "/", targets.length);
    } catch (e) {
      fail.push([g.id, String(e?.message || e)]);
    }
  }
}
await Promise.all(Array.from({ length: CONC }, worker));
ok.sort((a, b) => a - b);
await fs.writeFile(
  path.join(ROOT, "workers/api/src/boxart.json"),
  JSON.stringify(ok),
);
console.log("OK", ok.length, "FAIL", fail.length);
if (fail.length) console.log("failures (first 20):", fail.slice(0, 20));
