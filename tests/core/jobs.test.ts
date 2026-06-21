import { createJobRegistry, FrameworkError } from "../../src";

describe("JobRegistry", () => {
  it("lists jobs in stable name order", () => {
    const registry = createJobRegistry({
      jobs: [
        { name: "zeta", handler: () => undefined },
        { name: "alpha", handler: () => undefined }
      ]
    });

    expect(registry.list().map((job) => job.name)).toEqual(["alpha", "zeta"]);
  });

  it("rejects duplicate job names", () => {
    const registry = createJobRegistry({
      jobs: [{ name: "email.digest", handler: () => undefined }]
    });

    expect(() => registry.register({ name: "email.digest", handler: () => undefined })).toThrow(
      FrameworkError
    );
  });

  it("reports missing jobs as framework errors", () => {
    const registry = createJobRegistry();

    expect(() => registry.get("missing")).toThrow(
      expect.objectContaining({ code: "JOB_NOT_FOUND", status: 404 })
    );
  });
});
