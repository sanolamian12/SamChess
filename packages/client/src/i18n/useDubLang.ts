/**
 * 더빙 선택이 바뀌면 화면을 다시 그린다. `useLang.ts`와 같은 이유로 여기 하나뿐 —
 * `i18n/index.ts`는 React를 몰라야 `npm test`가 그대로 실행할 수 있다.
 */

import { useSyncExternalStore } from 'react';
import { currentDubLang, onLangChange } from './index.ts';
import type { DubLang } from './index.ts';

export const useDubLang = (): DubLang =>
  useSyncExternalStore(onLangChange, currentDubLang, currentDubLang);
