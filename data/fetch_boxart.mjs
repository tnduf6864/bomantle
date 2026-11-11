// 정답 후보 박스아트를 받아 Pages에 재호스팅한다(apps/web/public/boxart/<id>.jpg).
//
// 보드라이프 페이지는 브라우저 크로스오리진·Worker 요청을 막아서 정답 카드 이미지를
// 핫링크할 수 없다. 이미지 서버(img.boardlife.co.kr)는 일반 요청에 정상 응답하므로
// 빌드 시 미리 받아 same-origin으로 서빙한다.
//
// - 대상 = 실제로 정답이 될 수 있는 게임: 워커와 **같은 함수**(answer.ts buildAnswerPool)로
//   만든 현재 풀 + 얼려 둔 구 풀(pool_v1.json — 지난 문제 다시 풀기에서 공개된다).
//   예전엔 풀 규칙을 여기 복사해 뒀다가 워커 규칙이 바뀌며 어긋났다.
// - **증분**: 이미 받은 파일은 건너뛰고, boxart.json은 기존 목록에 합친다. 예전엔
//   이번 실행의 성공분으로 통째로 덮어써서 네트워크가 흔들리면 멀쩡한 목록이 줄었다.
//
// 사용: node data/fetch_boxart.mjs   (루트에서, games.json 갱신 후)

import { Jimp } from "jimp";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "workers/api/src");
const OUT = path.join(ROOT, "apps/web/public/boxart");
const LIST = path.join(SRC, "boxart.json");

// Node 22.6+는 .ts를 타입만 지우고 바로 실행한다(answer.ts는 타입 import뿐).
const { buildAnswerPool } = await import(pathToFileURL(path.join(SRC, "answer.ts")).href);

const readJson = async (p) => JSON.parse(await fs.readFile(p, "utf8"));
const games = await readJson(path.join(SRC, "games.json"));
const byId = new Map(games.map((g) => [g.id, g]));
const poolIds = new Set([
  ...buildAnswerPool(games),
  ...(await readJson(path.join(SRC, "pool_v1.json"))),
]);

await fs.mkdir(OUT, { recursive: true });
const have = new Set(await readJson(LIST).catch(() => []));
const exists = async (p) => fs.access(p).then(() => true, () => false);

const targets = [];
let noImage = 0;
for (const id of poolIds) {
  const g = byId.get(id);
  if (!g?.image) {
    noImage++;
    continue;
  }
  if (have.has(id) && (await exists(path.join(OUT, `${id}.jpg`)))) continue;
  targets.push(g);
}
console.log(`풀 ${poolIds.size}개 · 보유 ${have.size} · 받을 것 ${targets.length} · 원본 이미지 없음 ${noImage}`);

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const CONC = 4; // 상대 서버 배려
const ok = [];
const fail = [];
let i = 0;

async function download(url) {
  for (let a = 0; ; a++) {
    try {
      const r = await fetch(url, {
        headers: {
          "User-Agent": UA,
          Referer: "https://boardlife.co.kr/",
          Accept: "image/avif,image/webp,image/*,*/*;q=0.8",
        },
      });
      if (!r.ok) throw new Error("status " + r.status);
      const type = r.headers.get("content-type") ?? "";
      if (!type.startsWith("image/")) throw new Error("not an image: " + type);
      return Buffer.from(await r.arrayBuffer());
    } catch (e) {
      if (a === 2) throw e;
      await new Promise((s) => setTimeout(s, 800 * (a + 1)));
    }
  }
}

async function worker() {
  while (i < targets.length) {
    const g = targets[i++];
    try {
      const img = await Jimp.read(await download(g.image));
      img.scaleToFit({ w: 320, h: 320 });
      const out = await img.getBuffer("image/jpeg", { quality: 80 });
      await fs.writeFile(path.join(OUT, `${g.id}.jpg`), out);
      ok.push(g.id);
    } catch (e) {
      fail.push([g.id, g.name_ko, String(e?.message || e)]);
    }
  }
}
await Promise.all(Array.from({ length: CONC }, worker));

// 기존 목록 ∪ 이번 성공분. 파일이 실제로 있는 것만 남긴다.
const merged = [];
for (const id of new Set([...have, ...ok])) {
  if (await exists(path.join(OUT, `${id}.jpg`))) merged.push(id);
}
merged.sort((a, b) => a - b);
await fs.writeFile(LIST, JSON.stringify(merged));

const missing = [...poolIds].filter((id) => !merged.includes(id));
console.log(`받음 ${ok.length} · 실패 ${fail.length} → boxart.json ${merged.length}개 · 풀 중 이미지 없음 ${missing.length}`);
if (fail.length) console.log("실패:", fail.slice(0, 20));
