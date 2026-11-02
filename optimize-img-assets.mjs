/**
 * Optimize a single image while preserving transparency and format differences.
 *
 * @param {string} input  Path to the source file.
 * @param {object} [options]
 * @param {string}  [options.output]                Output path (default: next to input).
 * @param {string}  [options.format="webp"]         "webp" | "avif" | "jpeg" | "png" | "keep".
 * @param {number}  [options.quality]               Quality (default depends on format).
 * @param {number}  [options.maxWidth]              Max width.
 * @param {number}  [options.maxHeight]             Max height.
 * @param {string}  [options.fit="inside"]          "inside" | "cover" | "contain" | "fill".
 * @param {boolean} [options.deleteOriginal=false]  Delete source after success.
 * @param {boolean} [options.overwrite=false]       Overwrite existing output.
 * @param {boolean} [options.onlyIfSmaller=true]    Keep original if output is larger.
 * @param {boolean} [options.lossless=false]        WebP/AVIF only.
 *
 * @returns {Promise<{input:string, output:string, inputSize:number, outputSize:number, skipped:boolean, reason?:string}>}
 */
import { stat, rename, unlink } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const RASTER_INPUTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".avif", ".tiff", ".tif", ".bmp", ".gif"]);
const SKIP_EXTS = new Set([".svg", ".ico"]);
const FORMAT_EXT = { webp: ".webp", avif: ".avif", jpeg: ".jpg", png: ".png" };
const DEFAULT_QUALITY = { webp: 82, avif: 60, jpeg: 82, png: 82 };

async function fileSize(file) {
    try {
        return (await stat(file)).size;
    } catch {
        return 0;
    }
}

function replaceExt(file, ext) {
    return file.replace(/\.[^.]+$/, ext);
}

export async function optimizeImage(input, options = {}) {
    const {
        output,
        format = "webp",
        quality,
        maxWidth,
        maxHeight,
        fit = "inside",
        deleteOriginal = false,
        overwrite = false,
        onlyIfSmaller = true,
        lossless = false,
    } = options;

    // 1) Validate input.
    const inSize = await fileSize(input);
    if (inSize === 0) throw new Error(`file not found or empty: ${input}`);

    const inExt = path.extname(input).toLowerCase();

    if (SKIP_EXTS.has(inExt)) {
        return {
            input,
            output: input,
            inputSize: inSize,
            outputSize: inSize,
            skipped: true,
            reason: `unsupported format: ${inExt}`,
        };
    }
    if (!RASTER_INPUTS.has(inExt)) {
        return {
            input,
            output: input,
            inputSize: inSize,
            outputSize: inSize,
            skipped: true,
            reason: `unknown format: ${inExt}`,
        };
    }

    // 2) Read metadata.
    const meta = await sharp(input).metadata();
    const isAnimated = (meta.pages ?? 1) > 1;
    const hasAlpha = !!meta.hasAlpha;

    // 3) Resolve output format.
    let outFormat = format;
    if (outFormat === "keep") {
        if (inExt === ".jpg" || inExt === ".jpeg") outFormat = "jpeg";
        else if (inExt === ".png") outFormat = "png";
        else if (inExt === ".webp") outFormat = "webp";
        else if (inExt === ".avif") outFormat = "avif";
        else
            return {
                input,
                output: input,
                inputSize: inSize,
                outputSize: inSize,
                skipped: true,
                reason: `'keep' not supported for ${inExt}`,
            };
    }
    if (!FORMAT_EXT[outFormat]) throw new Error(`unsupported output format: ${outFormat}`);

    const outExt = FORMAT_EXT[outFormat];
    const outPath = output ?? replaceExt(input, outExt);
    const inPlace = path.resolve(outPath) === path.resolve(input);

    // Skip if a different output already exists (unless overwrite).
    if (!inPlace && !overwrite) {
        const existing = await fileSize(outPath);
        if (existing > 0) {
            return {
                input,
                output: outPath,
                inputSize: inSize,
                outputSize: existing,
                skipped: true,
                reason: `output exists`,
            };
        }
    }

    // 4) Build pipeline.
    let pipeline = sharp(input, isAnimated ? { animated: true } : {});

    if (maxWidth || maxHeight) {
        const resizeOpts = { width: maxWidth, height: maxHeight, fit, withoutEnlargement: true };
        // Only "contain" needs a background; keep alpha when available.
        if (fit === "contain") {
            resizeOpts.background = hasAlpha ? { r: 0, g: 0, b: 0, alpha: 0 } : "#ffffff";
        }
        pipeline = pipeline.resize(resizeOpts);
    }

    const q = quality ?? DEFAULT_QUALITY[outFormat];

    switch (outFormat) {
        case "webp":
            pipeline = pipeline.webp({
                quality: q,
                alphaQuality: 100, // Preserve full alpha quality.
                lossless,
                effort: 4,
            });
            break;

        case "avif":
            pipeline = pipeline.avif({ quality: q, lossless, effort: 4 });
            break;

        case "jpeg":
            // JPEG has no alpha; flatten onto white.
            if (hasAlpha) pipeline = pipeline.flatten({ background: "#ffffff" });
            pipeline = pipeline.jpeg({ quality: q, mozjpeg: true });
            break;

        case "png":
            // PNG keeps alpha natively.
            pipeline = pipeline.png({ compressionLevel: 9 });
            break;
    }

    // 5) Write to a temp file, then atomically replace.
    const tmp = `${outPath}.tmp-${process.pid}-${Date.now()}`;
    await pipeline.toFile(tmp);
    const outSize = await fileSize(tmp);

    if (onlyIfSmaller && outSize >= inSize) {
        await unlink(tmp).catch(() => {});
        return {
            input,
            output: input,
            inputSize: inSize,
            outputSize: inSize,
            skipped: true,
            reason: `optimized size (${outSize}B) >= original (${inSize}B)`,
        };
    }

    await rename(tmp, outPath);

    if (deleteOriginal && !inPlace) {
        await unlink(input).catch(() => {});
    }

    return { input, output: outPath, inputSize: inSize, outputSize: outSize, skipped: false };
}
