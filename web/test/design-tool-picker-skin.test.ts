import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

// Bun 直接执行 TypeScript 测试时需要保留扩展名；生产 tsconfig 不包含 test/。
const read = (path: string) => readFileSync(resolve(import.meta.dir, path), "utf8");

test("设计工具的选择器皮肤放在独立 CSS 文件里，由使用方 import", () => {
    const css = read("../src/pages/design/design-tools.css");

    assert.ok(css.includes(".app-user-workspace .design-tool-picker.creation-model-picker.canvas-composer-model-picker"), "皮肤要挂在 design-tool-picker 类上");
    // 用工作台令牌而不是创作页那套写死底色，皮肤才能跟着明暗主题走。
    assert.ok(css.includes("var(--user-surface-muted)"), "底色要用工作台令牌");
    assert.ok(css.includes("var(--user-surface-hover)"), "hover 要用工作台令牌");
    // AI 模特卡片的挂载点是 workbench 模块本身：独立 /ai-model 路由与设计中心内嵌都会加载它。
    assert.ok(read("../src/pages/ai-model/index.tsx").includes('import "@/pages/design/design-tools.css"'), "AI 模特必须加载选择器皮肤");
});

// 上游几乎每天改 globals.css（最近 30 次改动覆盖 09-03～09-17 每一天，单次可达 +3593 行），
// 新章节又都往文件尾部追加；本地皮肤放进去等于每次拉上游都要在尾部区域解一次冲突。
test("这条皮肤不再写进 globals.css", () => {
    assert.ok(!read("../src/styles/globals.css").includes("design-tool-picker"), "globals.css 不应再出现 design-tool-picker");
});
