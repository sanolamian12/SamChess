/**
 * 언어가 바뀌면 화면을 다시 그린다.
 *
 * `i18n/index.ts`는 React를 모른다 — `npm test`가 그대로 실행할 수 있어야 해서다.
 * 그 표와 React를 잇는 자리가 여기 하나뿐이다.
 */

import { useSyncExternalStore } from 'react';
import { currentLang, onLangChange } from './index.ts';
import type { Lang } from './index.ts';

export const useLang = (): Lang => useSyncExternalStore(onLangChange, currentLang, currentLang);
