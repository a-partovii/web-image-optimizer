# web-image-optimizer

A single MJS script to optimize images in your website backend.

One exported function. No configuration files. Just Sharp and a file path.

## Requirements

- Node.js 18+
- [sharp](https://sharp.pixelplumbing.com/)

## Setup

Copy `optimize-image.mjs` into your project and install Sharp:

```bash
npm install sharp
```

## Usage

```js
import { optimizeImage } from "./optimize-image.mjs";

const result = await optimizeImage("public/image.png", {
    format: "webp",
    quality: 82,
    maxWidth: 1200,
});

console.log(result);
```

## Options

| Option           | Default         | Description                           |
| ---------------- | --------------- | ------------------------------------- |
| `output`         | Auto            | Custom output path                    |
| `format`         | `"webp"`        | `webp`, `avif`, `jpeg`, `png`, `keep` |
| `quality`        | Format-specific | WebP/JPEG: 82, AVIF: 60               |
| `maxWidth`       | —               | Maximum width                         |
| `maxHeight`      | —               | Maximum height                        |
| `fit`            | `"inside"`      | `inside`, `cover`, `contain`, `fill`  |
| `deleteOriginal` | `false`         | Delete source after success           |
| `overwrite`      | `false`         | Replace existing output               |
| `onlyIfSmaller`  | `true`          | Skip if output is not smaller         |
| `lossless`       | `false`         | Lossless WebP/AVIF                    |

## Return Value

```js
{
    input: "public/image.png",
    output: "public/image.webp",
    inputSize: 120400,
    outputSize: 18300,
    skipped: false
}
```

Sizes are in bytes. Skipped operations include a `reason`.

## Features

- Supports JPEG, PNG, WebP, AVIF, TIFF, BMP, and GIF.
- Preserves transparency where supported.
- Supports animated GIF to animated WebP conversion.
- Resizes images without upscaling.
- Uses temporary files for safer writes.
- Keeps original files by default.
- Skips SVG, ICO, and unsupported formats.
- Strips metadata by default.

## Notes

- `format: "keep"` supports JPEG, PNG, WebP, and AVIF.
- JPEG output flattens transparency onto white.
- PNG output uses lossless compression.
- HEIF/HEIC input is not supported.
- Existing outputs are skipped unless `overwrite: true`.
