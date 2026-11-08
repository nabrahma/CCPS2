// The environment for builds that link ufbx through cgo (TOOLCHAIN.md): the
// 64-bit mingw-w64 compiler first on the PATH. Set PS2CC_CC to use another one.
import { existsSync } from 'node:fs';
import { delimiter, dirname } from 'node:path';

export function cgoEnv() {
  const candidates = [process.env.PS2CC_CC, 'C:\\mingw64\\bin\\x86_64-w64-mingw32-gcc.exe', 'C:\\msys64\\ucrt64\\bin\\gcc.exe'].filter(Boolean);
  const cc = candidates.find((c) => existsSync(c));
  if (!cc) {
    console.error('No 64-bit mingw-w64 gcc found (see TOOLCHAIN.md). Set PS2CC_CC to its path.');
    process.exit(1);
  }
  return { ...process.env, CGO_ENABLED: '1', CC: cc, PATH: `${dirname(cc)}${delimiter}${process.env.PATH ?? ''}` };
}
