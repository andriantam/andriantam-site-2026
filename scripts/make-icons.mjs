import sharp from "sharp";
import fs from "node:fs";
const T = 'M33 61C70 84 150 96 269.5 96S469 84 506 61V136H33ZM191 136h37v312h-37ZM312 136h38v312h-38Z';
// Black square with the white T, like the Toge profile picture. Run: node scripts/make-icons.mjs public
const tile = (pad) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#0b0a0e"/><svg x="${pad}" y="${pad}" width="${100 - 2 * pad}" height="${100 - 2 * pad}" viewBox="33 18 473 473"><path fill="#fff" d="${T}"/></svg></svg>`);
const out = process.argv[2];
const make = (size, pad, name) => sharp(tile(pad), { density: 600 }).resize(size, size).png().toFile(`${out}/${name}`);
await make(16, 8, "favicon-16x16.png");
await make(32, 10, "favicon-32x32.png");
await make(180, 19, "apple-touch-icon.png");
await make(192, 19, "logo192.png");
await make(512, 19, "logo512.png");
// favicon.ico holding one 32px PNG
const png = fs.readFileSync(`${out}/favicon-32x32.png`);
const h = Buffer.alloc(22);
h.writeUInt16LE(0, 0); h.writeUInt16LE(1, 2); h.writeUInt16LE(1, 4);
h.writeUInt8(32, 6); h.writeUInt8(32, 7); h.writeUInt8(0, 8); h.writeUInt8(0, 9);
h.writeUInt16LE(1, 10); h.writeUInt16LE(32, 12); h.writeUInt32LE(png.length, 14); h.writeUInt32LE(22, 18);
fs.writeFileSync(`${out}/favicon.ico`, Buffer.concat([h, png]));
console.log("icons ok");
