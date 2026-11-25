/**
 * Client-side canvas image compressor for low-end Android phones & slow networks.
 * Resizes large camera/gallery register photos and compresses to JPEG before
 * uploading to Firebase Storage and sending to Gemini Vision.
 */

export const MAX_RAW_IMAGE_BYTES = 15 * 1024 * 1024; // 15 MB raw guard
export const TARGET_MAX_DIMENSION_PX = 1440;
export const TARGET_MAX_COMPRESSED_BYTES = 850 * 1024; // ~850 KB target

const ALLOWED_INPUT_MIME_PREFIXES = ['image/'];

export interface CompressedPhotoResult {
  blob: Blob;
  base64: string;
  mimeType: 'image/jpeg';
  width: number;
  height: number;
  originalBytes: number;
  compressedBytes: number;
  previewObjectUrl: string;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const commaIdx = result.indexOf(',');
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.onerror = () => reject(new Error('IMAGE_READ_FAILED'));
    reader.readAsDataURL(blob);
  });
}

function loadImageElement(file: File): Promise<{ img: HTMLImageElement; tempUrl: string }> {
  return new Promise((resolve, reject) => {
    const tempUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, tempUrl });
    img.onerror = () => {
      URL.revokeObjectURL(tempUrl);
      reject(new Error('IMAGE_DECODE_FAILED'));
    };
    img.src = tempUrl;
  });
}

function canvasToJpegBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('IMAGE_COMPRESS_FAILED'));
          return;
        }
        resolve(blob);
      },
      'image/jpeg',
      quality
    );
  });
}

export function formatFileSizeKb(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

export async function compressRegisterPhoto(
  file: File,
  options?: { maxDimensionPx?: number; maxBytes?: number }
): Promise<CompressedPhotoResult> {
  if (!file || !ALLOWED_INPUT_MIME_PREFIXES.some((p) => file.type.startsWith(p))) {
    throw new Error('IMAGE_UNSUPPORTED_TYPE');
  }
  if (file.size > MAX_RAW_IMAGE_BYTES) {
    throw new Error('IMAGE_TOO_LARGE');
  }

  const maxDim = options?.maxDimensionPx ?? TARGET_MAX_DIMENSION_PX;
  const maxBytes = options?.maxBytes ?? TARGET_MAX_COMPRESSED_BYTES;

  const { img, tempUrl } = await loadImageElement(file);
  try {
    const srcW = img.naturalWidth || img.width;
    const srcH = img.naturalHeight || img.height;
    if (srcW <= 0 || srcH <= 0) {
      throw new Error('IMAGE_DECODE_FAILED');
    }

    const scale = Math.min(1, maxDim / Math.max(srcW, srcH));
    const targetW = Math.max(1, Math.round(srcW * scale));
    const targetH = Math.max(1, Math.round(srcH * scale));

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('IMAGE_COMPRESS_FAILED');
    }

    // White background prevents transparent PNGs turning black in JPEG
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, targetW, targetH);
    ctx.drawImage(img, 0, 0, targetW, targetH);

    let quality = 0.8;
    let blob = await canvasToJpegBlob(canvas, quality);

    while (blob.size > maxBytes && quality > 0.45) {
      quality = Number((quality - 0.1).toFixed(2));
      blob = await canvasToJpegBlob(canvas, quality);
    }

    const base64 = await blobToBase64(blob);
    const previewObjectUrl = URL.createObjectURL(blob);

    return {
      blob,
      base64,
      mimeType: 'image/jpeg',
      width: targetW,
      height: targetH,
      originalBytes: file.size,
      compressedBytes: blob.size,
      previewObjectUrl,
    };
  } finally {
    URL.revokeObjectURL(tempUrl);
  }
}
