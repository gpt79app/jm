// zip 안의 파일들을 꺼낸다(압축 없음·deflate). 브라우저의 DecompressionStream 을 쓴다
const dec = new TextDecoder();

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/// 넣을 CSV 인가: Mac 이 덧붙이는 __MACOSX/·._이름 과 숨김 파일은 뺀다
export function isCSVEntry(name) {
  const base = name.split("/").pop();
  return name.toLowerCase().endsWith(".csv") && !name.split("/").includes("__MACOSX") && !base.startsWith(".");
}

/// buffer: ArrayBuffer → [{ name, data(Uint8Array) }] (폴더 항목은 빼고)
export async function unzip(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  // 끝 레코드(EOCD)를 뒤에서 찾는다(주석이 있으면 더 앞에 있다)
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error("zip 이 아닙니다");
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const out = [];
  for (let n = 0; n < count; n++) {
    if (view.getUint32(at, true) !== 0x02014b50) throw new Error("zip 목록이 깨졌습니다");
    const method = view.getUint16(at + 10, true);
    const size = view.getUint32(at + 20, true);
    const nameLen = view.getUint16(at + 28, true), extraLen = view.getUint16(at + 30, true), commentLen = view.getUint16(at + 32, true);
    const localAt = view.getUint32(at + 42, true);
    const name = dec.decode(bytes.subarray(at + 46, at + 46 + nameLen));
    at += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/")) continue;
    const dataAt = localAt + 30 + view.getUint16(localAt + 26, true) + view.getUint16(localAt + 28, true);
    const raw = bytes.subarray(dataAt, dataAt + size);
    if (method === 0) out.push({ name, data: raw });
    else if (method === 8) out.push({ name, data: await inflateRaw(raw) });
    else throw new Error(`${name}: 이 압축 방식은 못 엽니다`);
  }
  return out;
}
