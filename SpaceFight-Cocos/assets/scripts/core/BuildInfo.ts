/**
 * 构建版本单一真源（给启动/前哨等界面显示用）。
 * ⚠️ 每次发版必须与 package.json / settings/v2/packages/project.json 的 version/build 一起改。
 * 之前 NativeCombatHud 里写死 'CLIENT 60'，导致任何版本升级后启动界面都还是老号——
 * 用户报「启动画面为什么还是 client 57」即此因。
 */
export const BUILD_INFO = {
  version: '0.13.12',
  build: 76,
} as const;

export function buildLabel(): string {
  return `v${BUILD_INFO.version}  BUILD ${BUILD_INFO.build}`;
}
