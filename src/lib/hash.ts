/**
 * 클라이언트(브라우저)에서 파일의 SHA-256 해시를 계산.
 * Web Crypto API (crypto.subtle) 사용 — 별도 라이브러리 불필요.
 */
export async function sha256File(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  return bufferToHex(hashBuffer);
}

/** 서버에서 ArrayBuffer/Buffer 해시 (검증용) */
export async function sha256Buffer(
  buffer: ArrayBuffer | Uint8Array
): Promise<string> {
  const data: BufferSource =
    buffer instanceof Uint8Array
      ? (buffer.buffer.slice(
          buffer.byteOffset,
          buffer.byteOffset + buffer.byteLength
        ) as ArrayBuffer)
      : buffer;
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return bufferToHex(hashBuffer);
}

function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
