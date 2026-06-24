import {
  InMemoryEventStore,
  PrintSettingsService,
  SYSTEM_MANAGER_ROLE,
  deterministicIds,
  fixedClock,
  printSettingsStream
} from "../../src";
import { owner } from "../helpers";

const admin = {
  id: "admin@example.com",
  roles: [SYSTEM_MANAGER_ROLE],
  tenantId: "acme"
};

describe("PrintSettingsService", () => {
  it("stores tenant print settings changes as append-only events", async () => {
    const events = new InMemoryEventStore();
    const settings = new PrintSettingsService({
      events,
      ids: deterministicIds(["settings-1", "settings-2"]),
      clock: fixedClock("2026-01-03T00:00:00.000Z")
    });

    const initial = await settings.get(admin);
    const changed = await settings.change({
      actor: admin,
      expectedVersion: 0,
      settings: {
        defaultLayout: {
          pageSize: "A4",
          orientation: "landscape",
          margins: { topMm: 12, rightMm: 10, bottomMm: 14, leftMm: 10 },
          font: { family: "Inter", sizePt: 10 }
        }
      }
    });
    const cleared = await settings.change({
      actor: admin,
      expectedVersion: 1,
      settings: { defaultLayout: null }
    });

    expect(initial).toEqual({ tenantId: "acme", version: 0, settings: {} });
    expect(changed).toEqual({
      tenantId: "acme",
      version: 1,
      settings: {
        defaultLayout: {
          pageSize: "A4",
          orientation: "landscape",
          margins: { topMm: 12, rightMm: 10, bottomMm: 14, leftMm: 10 },
          font: { family: "Inter", sizePt: 10 }
        }
      },
      updatedAt: "2026-01-03T00:00:00.000Z"
    });
    expect(cleared).toEqual({
      tenantId: "acme",
      version: 2,
      settings: {},
      updatedAt: "2026-01-03T00:00:00.000Z"
    });
    await expect(events.readStream(printSettingsStream("acme"))).resolves.toMatchObject([
      {
        id: "evt_settings-1",
        type: "PrintSettingsChanged",
        doctype: "__PrintSettings",
        documentName: "settings",
        actorId: admin.id,
        payload: {
          kind: "PrintSettingsChanged",
          settings: {
            defaultLayout: {
              pageSize: "A4",
              orientation: "landscape"
            }
          }
        }
      },
      {
        id: "evt_settings-2",
        payload: {
          kind: "PrintSettingsChanged",
          settings: { defaultLayout: null }
        }
      }
    ]);
  });

  it("requires print settings administrators, tenant scope, current versions, and valid layout", async () => {
    const events = new InMemoryEventStore();
    const settings = new PrintSettingsService({
      events,
      ids: deterministicIds(["settings-1"]),
      clock: fixedClock("2026-01-03T00:00:00.000Z")
    });

    await expect(settings.get(owner)).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(
      settings.change({ actor: admin, tenantId: "globex", expectedVersion: 0, settings: { defaultLayout: null } })
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(
      settings.change({ actor: admin, expectedVersion: 1, settings: { defaultLayout: null } })
    ).rejects.toMatchObject({ code: "DOCUMENT_CONFLICT" });
    await expect(
      settings.change({
        actor: admin,
        expectedVersion: 0,
        settings: { defaultLayout: { font: { family: "Inter; color:red" } } }
      })
    ).rejects.toMatchObject({ code: "PRINT_FORMAT_INVALID" });
    await expect(
      settings.change({ actor: admin, expectedVersion: 0, settings: { unknown: true } })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
