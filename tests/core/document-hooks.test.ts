import { defineDocumentHooks } from "../../src";

describe("document hooks", () => {
  it("snapshots hook entries by value", () => {
    const beforeValidate = vi.fn();
    const replacementBeforeValidate = vi.fn();
    const hooks = { beforeValidate };

    const snapshot = defineDocumentHooks(hooks);
    hooks.beforeValidate = replacementBeforeValidate;

    expect(snapshot.beforeValidate).toBe(beforeValidate);
    expect(snapshot.beforeValidate).not.toBe(replacementBeforeValidate);
    expect(Object.isFrozen(snapshot)).toBe(true);
  });
});
