import { describe, expect, it } from "vitest";

import {
  createServices,
  data,
  guest,
  owner
} from "../helpers";

describe("DocumentShareService", () => {
  it("plans share-management access through static and shared document permissions", async () => {
    const { documents, documentShares, registry } = createServices(["create-1", "share-1"]);
    const collaborator = { ...owner, id: "collab@example.com" };
    const created = await documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "Shared Management" })
    });

    await expect(
      documentShares.getDocumentShares(owner, registry.get("Note"), created)
    ).resolves.toMatchObject({ grants: [] });
    await expect(
      documentShares.getDocumentShares(guest, registry.get("Note"), created)
    ).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
      message: "Actor 'guest' cannot manage shares for Note/Shared Management"
    });

    const shared = await documents.share({
      actor: owner,
      doctype: "Note",
      name: "Shared Management",
      userId: collaborator.id,
      permissions: ["share"],
      expectedVersion: 1
    });

    await expect(
      documentShares.getDocumentShares(collaborator, registry.get("Note"), shared)
    ).resolves.toMatchObject({
      grants: [
        {
          userId: collaborator.id,
          permissions: ["read", "share"]
        }
      ]
    });
  });
});
