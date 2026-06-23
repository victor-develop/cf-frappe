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

  it("registers worker pools and resolves job pools", () => {
    const registry = createJobRegistry({
      workerPools: [
        {
          name: "reports",
          description: "Report workers",
          concurrency: 3,
          retry: { maxAttempts: 5, baseDelaySeconds: 10 }
        }
      ],
      jobs: [
        { name: "reports.daily", pool: "reports", handler: () => undefined },
        { name: "email.digest", handler: () => undefined }
      ]
    });

    expect(registry.listWorkerPools()).toEqual([
      { name: "default", concurrency: 1 },
      {
        name: "reports",
        description: "Report workers",
        concurrency: 3,
        retry: { maxAttempts: 5, baseDelaySeconds: 10 }
      }
    ]);
    expect(registry.workerPoolFor("reports.daily")).toMatchObject({ name: "reports", concurrency: 3 });
    expect(registry.workerPoolFor("email.digest")).toEqual({ name: "default", concurrency: 1 });
    expect(registry.list().find((job) => job.name === "reports.daily")).toMatchObject({ pool: "reports" });
  });

  it("rejects duplicate job names", () => {
    const registry = createJobRegistry({
      jobs: [{ name: "email.digest", handler: () => undefined }]
    });

    expect(() => registry.register({ name: "email.digest", handler: () => undefined })).toThrow(
      FrameworkError
    );
  });

  it("rejects invalid worker pool configuration and missing job pools", () => {
    expect(() =>
      createJobRegistry({
        workerPools: [
          { name: "reports", concurrency: 1 },
          { name: " reports ", concurrency: 2 }
        ]
      })
    ).toThrow(FrameworkError);
    expect(() => createJobRegistry({ workerPools: [{ name: "reports", concurrency: 0 }] }))
      .toThrow("concurrency must be a positive integer");
    expect(() => createJobRegistry({ workerPools: [{ name: "reports", retry: { baseDelaySeconds: 0 } }] }))
      .toThrow("Job worker pool 'reports' retry baseDelaySeconds must be an integer between 1 and 86400");
    expect(() =>
      createJobRegistry({ jobs: [{ name: "bad.retry", retry: { maxAttempts: 0 }, handler: () => undefined }] })
    ).toThrow("Job 'bad.retry' retry maxAttempts must be a positive integer");
    expect(() =>
      createJobRegistry({
        jobs: [{ name: "reports.daily", pool: "reports", handler: () => undefined }]
      })
    ).toThrow("Job worker pool 'reports' is not registered");
  });

  it("reports missing jobs as framework errors", () => {
    const registry = createJobRegistry();

    expect(() => registry.get("missing")).toThrow(
      expect.objectContaining({ code: "JOB_NOT_FOUND", status: 404 })
    );
  });
});
