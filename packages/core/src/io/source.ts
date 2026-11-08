import { Container, type ContainerMeta } from './container';

/**
 * Where compiled assets come from. The desktop app implements this over HTTP
 * (Wails asset server); tests implement it over the file system.
 */
export interface AssetSource {
  readText(path: string): Promise<string>;
  readBinary(path: string): Promise<ArrayBuffer>;
}

export async function readJson<T>(source: AssetSource, path: string): Promise<T> {
  const text = await source.readText(path);
  try {
    return JSON.parse(text) as T;
  } catch (err) {
    throw new Error(`invalid JSON in ${path}: ${(err as Error).message}`, { cause: err });
  }
}

/** Load `<base>.json` + its binary. `base` has no extension. */
export async function readContainer<M extends ContainerMeta>(source: AssetSource, base: string): Promise<Container<M>> {
  const meta = await readJson<M>(source, `${base}.json`);
  const dir = base.includes('/') ? base.slice(0, base.lastIndexOf('/') + 1) : '';
  const bin = await source.readBinary(dir + meta.binary);
  return new Container(meta, bin);
}

/** Asset source backed by fetch() against a base URL (used by the app). */
export class FetchAssetSource implements AssetSource {
  constructor(private readonly baseUrl: string) {}

  private url(path: string): string {
    return this.baseUrl.replace(/\/$/, '') + '/' + path.replace(/^\//, '');
  }

  async readText(path: string): Promise<string> {
    const res = await fetch(this.url(path));
    if (!res.ok) throw new Error(`failed to load ${path}: HTTP ${res.status}`);
    return res.text();
  }

  async readBinary(path: string): Promise<ArrayBuffer> {
    const res = await fetch(this.url(path));
    if (!res.ok) throw new Error(`failed to load ${path}: HTTP ${res.status}`);
    return res.arrayBuffer();
  }
}
