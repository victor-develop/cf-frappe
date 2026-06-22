import { defineClientScript, FrameworkError } from "../../src";

describe("client scripts", () => {
  it("defines immutable same-origin browser script metadata", () => {
    const script = defineClientScript({
      name: "note-form",
      doctype: "Note",
      src: "/assets/note-form.js",
      scope: "form",
      type: "module",
      label: "Note form behavior"
    });

    expect(script).toMatchObject({
      name: "note-form",
      doctype: "Note",
      src: "/assets/note-form.js",
      scope: "form",
      type: "module"
    });
    expect(Object.isFrozen(script)).toBe(true);
  });

  it("normalizes leading and trailing whitespace before storing metadata", () => {
    expect(defineClientScript({ name: " note ", doctype: " Note ", src: " /assets/note.js " })).toEqual({
      name: "note",
      doctype: "Note",
      src: "/assets/note.js"
    });
  });

  it("rejects unsafe or ambiguous client script definitions", () => {
    expect(() => defineClientScript({ name: "", doctype: "Note", src: "/assets/note.js" })).toThrow(FrameworkError);
    expect(() => defineClientScript({ name: "note", doctype: "", src: "/assets/note.js" })).toThrow(
      "DocType"
    );
    expect(() => defineClientScript({ name: "note", doctype: "Note", src: "https://cdn.example/note.js" })).toThrow(
      "same-origin absolute path"
    );
    expect(() => defineClientScript({ name: "note", doctype: "Note", src: "//cdn.example/note.js" })).toThrow(
      "same-origin absolute path"
    );
    expect(() => defineClientScript({ name: "note", doctype: "Note", src: "/assets\\note.js" })).toThrow(
      "same-origin absolute path"
    );
    expect(() => defineClientScript({ name: "note", doctype: "Note", src: "/assets/note\u0000.js" })).toThrow(
      "same-origin absolute path"
    );
    expect(() =>
      defineClientScript({
        name: "note",
        doctype: "Note",
        src: "/assets/note.js",
        scope: "grid" as unknown as "form"
      })
    ).toThrow("scope must be form, list, or both");
    expect(() =>
      defineClientScript({
        name: "note",
        doctype: "Note",
        src: "/assets/note.js",
        type: "defer" as unknown as "module"
      })
    ).toThrow("type must be module or classic");
  });
});
