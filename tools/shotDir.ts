/**
 * 검사 도구의 사진 폴더 — `SHOTS`(또는 `OUT`)를 안 주면 OS 임시 폴더의 `samchess-shots/<도구>`로 (2026-11-19).
 * 예전 기본값은 「지금 폴더」(`.`)라 저장소 맨 위에 사진이 수십 장씩 쌓였다(.gitignore라 커밋엔 안 들어가도 폴더가 어지럽다).
 */
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function shotDir(tool: string): string {
  const dir = join(tmpdir(), 'samchess-shots', tool);
  mkdirSync(dir, { recursive: true });
  return dir;
}
