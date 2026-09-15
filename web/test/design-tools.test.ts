import { describe, expect, test } from "bun:test";

import { DESIGN_TOOL_GROUPS, DESIGN_TOOLS } from "../src/constant/design-tools";

describe("设计中心工具目录", () => {
    test("工具 id 全局唯一", () => {
        const ids = DESIGN_TOOLS.map((tool) => tool.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    test("只有已接入流程的工具标记为 available", () => {
        expect(DESIGN_TOOLS.filter((tool) => tool.status === "available").map((tool) => tool.id)).toEqual(["ai-model"]);
    });

    test("每个分组和工具都有可展示的文案", () => {
        expect(DESIGN_TOOL_GROUPS.length).toBeGreaterThan(0);
        for (const group of DESIGN_TOOL_GROUPS) {
            expect(group.label.trim()).not.toBe("");
            expect(group.tools.length).toBeGreaterThan(0);
            for (const tool of group.tools) {
                expect(tool.label.trim()).not.toBe("");
                expect(tool.description.trim()).not.toBe("");
            }
        }
    });
});
