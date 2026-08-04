import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * 메타 화면(편성·장수 관리)은 React, 전투는 Phaser다.
 * 전투 UI는 DOM을 직접 다루므로 React가 그린 컨테이너 안에서 그대로 돈다 —
 * 「버튼 활성 여부는 validate()에 묻는다」는 계약만 지키면 어느 쪽이든 상관없다.
 */
export default defineConfig({
  plugins: [react()],
});
