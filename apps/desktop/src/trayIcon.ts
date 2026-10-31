// Draws the tray icon in code (a green dot) so the developer preview needs no image file or build step.
// A real icon arrives with the installer work (PRD S1).
// Spec: ARCHITECTURE.md section 13 (tray).

import { nativeImage, type NativeImage } from "electron";

const ICON_SIZE_PX = 32;
// 32 px drawn at 2x is a 16 x 16 point icon, which is the tray size on Windows and macOS.
const ICON_SCALE_FACTOR = 2;

// Raw bitmaps are BGRA on some platforms and RGBA on others. Red and blue are equal here on purpose,
// so the dot is the same green either way.
const RED_AND_BLUE = 0x3f;
const GREEN = 0xa3;

export function createTrayIcon(): NativeImage {
  const pixels = Buffer.alloc(ICON_SIZE_PX * ICON_SIZE_PX * 4);
  const middle = (ICON_SIZE_PX - 1) / 2;
  const radius = ICON_SIZE_PX / 2 - 1;

  for (let y = 0; y < ICON_SIZE_PX; y++) {
    for (let x = 0; x < ICON_SIZE_PX; x++) {
      const distanceFromMiddle = Math.hypot(x - middle, y - middle);
      // 1 inside the dot, 0 outside, a soft one pixel edge between.
      const coverage = Math.min(1, Math.max(0, radius - distanceFromMiddle + 0.5));
      const offset = (y * ICON_SIZE_PX + x) * 4;
      // Colour channels are premultiplied by the coverage, which is what the bitmap format expects.
      pixels[offset] = Math.round(RED_AND_BLUE * coverage);
      pixels[offset + 1] = Math.round(GREEN * coverage);
      pixels[offset + 2] = Math.round(RED_AND_BLUE * coverage);
      pixels[offset + 3] = Math.round(255 * coverage);
    }
  }

  return nativeImage.createFromBitmap(pixels, {
    width: ICON_SIZE_PX,
    height: ICON_SIZE_PX,
    scaleFactor: ICON_SCALE_FACTOR,
  });
}
