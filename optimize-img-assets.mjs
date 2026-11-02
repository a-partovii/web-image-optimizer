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

    // ۱) بررسی ورودی
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

    // ۲) متادیتا
    const meta = await sharp(input).metadata();
    const isAnimated = (meta.pages ?? 1) > 1;
    const hasAlpha = !!meta.hasAlpha;

    // ۳) فرمت خروجی
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

    // اگر خروجی جای دیگری است و وجود دارد → skip (مگر overwrite)
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

    // ۴) pipeline
    let pipeline = sharp(input, isAnimated ? { animated: true } : {});

    if (maxWidth || maxHeight) {
        const resizeOpts = { width: maxWidth, height: maxHeight, fit, withoutEnlargement: true };
        // فقط `contain` پدینگ لازم دارد
        if (fit === "contain") {
            resizeOpts.background = hasAlpha
                ? { r: 0, g: 0, b: 0, alpha: 0 } // شفاف
                : "#ffffff";
        }
        pipeline = pipeline.resize(resizeOpts);
    }

    const q = quality ?? DEFAULT_QUALITY[outFormat];

    switch (outFormat) {
        case "webp":
            pipeline = pipeline.webp({
                quality: q,
                alphaQuality: 100, // آلفا کامل حفظ می‌شود
                lossless,
                effort: 4,
            });
            break;

        case "avif":
            pipeline = pipeline.avif({ quality: q, lossless, effort: 4 });
            break;

        case "jpeg":
            // JPEG آلفا ندارد → روی سفید flatten کن
            if (hasAlpha) pipeline = pipeline.flatten({ background: "#ffffff" });
            pipeline = pipeline.jpeg({ quality: q, mozjpeg: true });
            break;

        case "png":
            // PNG آلفا را خود sharp حفظ می‌کند
            pipeline = pipeline.png({ compressionLevel: 9 });
            break;
    }

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
