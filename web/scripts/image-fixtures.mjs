// Test-only, deterministic and genuinely decodable images. Nothing here is
// used by production code; fixtures stand in for MangaDex page/cover bytes in
// the local Axum cache so browser decode assertions are meaningful.
import jpeg from "jpeg-js";
import { PNG } from "pngjs";

export const PAGE_WIDTH = 600;
export const PAGE_HEIGHT = 900;

export function pagePng(index = 0) {
  const png = new PNG({ width: PAGE_WIDTH, height: PAGE_HEIGHT });
  for (let y = 0; y < PAGE_HEIGHT; y += 1) {
    for (let x = 0; x < PAGE_WIDTH; x += 1) {
      const offset = (PAGE_WIDTH * y + x) << 2;
      const stripe = (x + y + index * 60) % 160 < 80;
      png.data[offset] = stripe ? 34 + index * 12 : 224;
      png.data[offset + 1] = stripe ? 52 : 236;
      png.data[offset + 2] = stripe ? 28 : 132;
      png.data[offset + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

export function coverJpg(size = 256) {
  const width = size;
  const height = Math.round(size * 1.5);
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (width * y + x) << 2;
      data[offset] = 40 + Math.round((x / width) * 180);
      data[offset + 1] = 70 + Math.round((y / height) * 150);
      data[offset + 2] = 30;
      data[offset + 3] = 255;
    }
  }
  return jpeg.encode({ data, width, height }, 88).data;
}
