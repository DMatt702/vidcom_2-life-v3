export type EntityId = string;

export interface HealthStatus {
  ok: boolean;
  timestamp: string;
}

export interface ImageFingerprint {
  v: 1;
  w: number;
  h: number;
  data: number[];
}

export async function generateImageFingerprint(
  blob: Blob,
  size = 16
): Promise<ImageFingerprint> {
  if (size <= 0) {
    throw new Error("Fingerprint size must be positive");
  }

  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    throw new Error("Canvas context not available");
  }

  context.drawImage(bitmap, 0, 0, size, size);
  const imageData = context.getImageData(0, 0, size, size);
  const data: number[] = [];
  for (let i = 0; i < imageData.data.length; i += 4) {
    const r = imageData.data[i] ?? 0;
    const g = imageData.data[i + 1] ?? 0;
    const b = imageData.data[i + 2] ?? 0;
    const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    data.push(gray);
  }
  bitmap.close();

  return {
    v: 1,
    w: size,
    h: size,
    data
  };
}
