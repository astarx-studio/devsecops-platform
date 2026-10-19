export type CropPoint = { x: number; y: number };
export type PixelCrop = { x: number; y: number; width: number; height: number };

const OUTPUT_MAX = 256;
const OUTPUT_MAX_CHARS = 48000;

export function rotateSize(width: number, height: number, rotation: number) {
    const rad = (rotation * Math.PI) / 180;
    return {
        width: Math.abs(Math.cos(rad) * width) + Math.abs(Math.sin(rad) * height),
        height: Math.abs(Math.sin(rad) * width) + Math.abs(Math.cos(rad) * height)
    };
}

export function zoomFromWheel(current: number, deltaY: number, deltaMode: number, min: number, max: number, viewport = 0) {
    const delta = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * viewport : deltaY;
    const next = current - delta / 200;
    return Math.round(Math.min(max, Math.max(min, next)) * 100) / 100;
}

export function fitZoom(mediaWidth: number, mediaHeight: number, cropSize: number, rotation: number) {
    if (mediaWidth <= 0 || mediaHeight <= 0 || cropSize <= 0) return 1;
    const box = rotateSize(mediaWidth, mediaHeight, rotation);
    const longest = Math.max(box.width, box.height);
    if (longest <= 0) return 1;
    return Math.min(1, cropSize / longest);
}

export function squareCropPixels(input: {
    crop: CropPoint;
    zoom: number;
    rotation: number;
    mediaWidth: number;
    mediaHeight: number;
    naturalWidth: number;
    naturalHeight: number;
    cropSize: number;
}): PixelCrop {
    const zoom = input.zoom > 0 ? input.zoom : 1;
    const mediaBox = rotateSize(input.mediaWidth, input.mediaHeight, input.rotation);
    const naturalBox = rotateSize(input.naturalWidth, input.naturalHeight, input.rotation);
    const xPct = ((mediaBox.width - input.cropSize / zoom) / 2 - input.crop.x / zoom) / mediaBox.width;
    const yPct = ((mediaBox.height - input.cropSize / zoom) / 2 - input.crop.y / zoom) / mediaBox.height;
    const width = (input.cropSize / mediaBox.width / zoom) * naturalBox.width;
    const height = (input.cropSize / mediaBox.height / zoom) * naturalBox.height;
    const side = Math.max(width, height);
    return { x: xPct * naturalBox.width, y: yPct * naturalBox.height, width: side, height: side };
}

function loadImage(src: string) {
    return new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("image"));
        img.src = src;
    });
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality?: number) {
    return new Promise<Blob | null>(resolve => canvas.toBlob(blob => resolve(blob), type, quality));
}

function blobToDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("image"));
        reader.readAsDataURL(blob);
    });
}

export async function renderSquareDataUrl(src: string, pixels: PixelCrop, rotation: number) {
    const image = await loadImage(src);
    const rad = (rotation * Math.PI) / 180;
    const box = rotateSize(image.naturalWidth, image.naturalHeight, rotation);
    const rotated = document.createElement("canvas");
    rotated.width = Math.max(1, Math.ceil(box.width));
    rotated.height = Math.max(1, Math.ceil(box.height));
    const ctx = rotated.getContext("2d");
    if (!ctx) throw new Error("image");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, rotated.width, rotated.height);
    ctx.translate(rotated.width / 2, rotated.height / 2);
    ctx.rotate(rad);
    ctx.translate(-image.naturalWidth / 2, -image.naturalHeight / 2);
    ctx.drawImage(image, 0, 0);

    let side = Math.min(OUTPUT_MAX, Math.max(1, Math.round(Math.max(pixels.width, pixels.height))));
    while (side >= 48) {
        const out = document.createElement("canvas");
        out.width = side;
        out.height = side;
        const outCtx = out.getContext("2d");
        if (!outCtx) throw new Error("image");
        outCtx.fillStyle = "#ffffff";
        outCtx.fillRect(0, 0, side, side);
        outCtx.imageSmoothingEnabled = true;
        outCtx.imageSmoothingQuality = "high";
        outCtx.drawImage(rotated, pixels.x, pixels.y, pixels.width, pixels.height, 0, 0, side, side);
        for (const quality of [0.86, 0.72, 0.58]) {
            const blob = await canvasBlob(out, "image/jpeg", quality);
            if (!blob || blob.size === 0) continue;
            const dataUrl = await blobToDataUrl(blob);
            if (dataUrl.startsWith("data:image/jpeg") && dataUrl.length <= OUTPUT_MAX_CHARS) return dataUrl;
        }
        side = Math.round(side * 0.8);
    }
    throw new Error("image");
}

export async function flipImageFile(file: File, axis: "horizontal" | "vertical") {
    const url = URL.createObjectURL(file);
    try {
        const image = await loadImage(url);
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("image");
        if (axis === "horizontal") {
            ctx.translate(canvas.width, 0);
            ctx.scale(-1, 1);
        } else {
            ctx.translate(0, canvas.height);
            ctx.scale(1, -1);
        }
        ctx.drawImage(image, 0, 0);
        const blob = await canvasBlob(canvas, "image/png");
        if (!blob) throw new Error("image");
        const base = file.name.replace(/\.[^.]+$/, "") || "image";
        return new File([blob], `${base}.png`, { type: "image/png" });
    } finally {
        URL.revokeObjectURL(url);
    }
}
