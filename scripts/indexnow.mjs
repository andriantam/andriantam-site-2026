// Pings IndexNow (Bing, Yandex, Naver, Seznam...) with every URL in the live sitemap.
// Run after a deploy: `node scripts/indexnow.mjs`. The key is the 32-hex-char file name in public/.
import fs from "node:fs";

const SITE = "https://andriantam.com";
const keyFile = fs.readdirSync("public").find((f) => /^[a-f0-9]{32}\.txt$/.test(f));
if (!keyFile) throw new Error("No IndexNow key file (<32 hex chars>.txt) found in public/");
const key = keyFile.replace(".txt", "");

const get = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.text();
};
const locs = (xml) => [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);

// Confirm the key is served, otherwise IndexNow rejects the submission.
const served = (await get(`${SITE}/${keyFile}`)).trim();
if (served !== key) throw new Error(`Key file at ${SITE}/${keyFile} does not match`);

const urls = [];
for (const sm of locs(await get(`${SITE}/sitemap-index.xml`))) urls.push(...locs(await get(sm)));
const urlList = [...new Set(urls)].slice(0, 10000);

const res = await fetch("https://api.indexnow.org/indexnow", {
  method: "POST",
  headers: { "content-type": "application/json; charset=utf-8" },
  body: JSON.stringify({ host: new URL(SITE).host, key, keyLocation: `${SITE}/${keyFile}`, urlList }),
});
console.log(`IndexNow: submitted ${urlList.length} URLs -> HTTP ${res.status}`); // 200/202 = accepted
if (res.status >= 400) process.exit(1);
