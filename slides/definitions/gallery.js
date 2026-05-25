import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { OUT_DIR, palette, WIDTH, HEIGHT } from "../../lib/constants.js";

const CACHE_PATH = path.join(".cache", "gallery.json");
const IMAGE_EXTENSIONS = new Set([".avif", ".gif", ".heic", ".jpeg", ".jpg", ".png", ".tif", ".tiff", ".webp"]);
const galleryBackground = {
  r: palette.bg[0],
  g: palette.bg[1],
  b: palette.bg[2],
  alpha: 1
};

async function listImages(galleryDir) {
  const dir = path.resolve(galleryDir);
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => path.join(dir, entry.name))
    .sort((a, b) => a.localeCompare(b));
}

async function readGalleryCache(galleryDir) {
  try {
    const cache = JSON.parse(await readFile(CACHE_PATH, "utf8"));
    if (cache.galleryDir === galleryDir && Number.isInteger(cache.nextIndex)) {
      return cache;
    }
  } catch {
    // Missing or malformed cache just means the gallery starts from the first image.
  }

  return { galleryDir, nextIndex: 0 };
}

async function writeGalleryCache(cache) {
  await mkdir(path.dirname(CACHE_PATH), { recursive: true });
  await writeFile(CACHE_PATH, `${JSON.stringify(cache, null, 2)}\n`);
}

async function nextGalleryImage(galleryDir) {
  const images = await listImages(galleryDir);
  if (images.length === 0) {
    return null;
  }

  const resolvedDir = path.resolve(galleryDir);
  const cache = await readGalleryCache(resolvedDir);
  const imageIndex = cache.nextIndex % images.length;
  await writeGalleryCache({
    galleryDir: resolvedDir,
    nextIndex: (imageIndex + 1) % images.length
  });

  return images[imageIndex];
}

async function canUseImageAsIs(imagePath) {
  if (path.extname(imagePath).toLowerCase() !== ".webp") {
    return false;
  }

  const metadata = await sharp(imagePath).metadata();
  return metadata.width === WIDTH && metadata.height === HEIGHT;
}

export default {
  id: "gallery",
  title: "Gallery",
  accent: palette.blue,
  progressBar: false,
  metadata: { trackName: "Gallery", artistName: "Dashboard", serviceName: "Local" },
  async renderFile({ options }) {
    const imagePath = await nextGalleryImage(options.galleryDir);
    if (!imagePath) return null;

    await mkdir(OUT_DIR, { recursive: true });
    const outputPath = path.join(OUT_DIR, "gallery.webp");

    if (await canUseImageAsIs(imagePath)) {
      await copyFile(imagePath, outputPath);
      return outputPath;
    }

    await sharp(imagePath)
      .rotate()
      .resize({
        width: WIDTH,
        height: HEIGHT,
        fit: "cover",
        position: "center",
        kernel: sharp.kernel.lanczos3
      })
      .flatten({ background: galleryBackground })
      .removeAlpha()
      .webp({ lossless: true, effort: 6 })
      .toFile(outputPath);

    return outputPath;
  }
};
