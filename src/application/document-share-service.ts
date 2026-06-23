import {
  documentShareAllows,
  documentSharePermissionsForActor,
  foldDocumentShares,
  type DocumentShareProvider,
  type DocumentShareState
} from "../core/document-shares.js";
import { permissionDenied } from "../core/errors.js";
import { can } from "../core/permissions.js";
import type { DocTypeDefinition } from "../core/types.js";
import type { Actor, DocumentSnapshot } from "../core/types.js";
import { documentStream } from "../core/streams.js";
import type { EventStore } from "../ports/event-store.js";

export interface DocumentShareServiceOptions {
  readonly events: Pick<EventStore, "readStream">;
}

export class DocumentShareService implements DocumentShareProvider {
  private readonly events: Pick<EventStore, "readStream">;

  constructor(options: DocumentShareServiceOptions) {
    this.events = options.events;
  }

  async sharedPermissionsFor(actor: Actor, document: DocumentSnapshot) {
    const state = await this.stateFor(document);
    return documentSharePermissionsForActor(actor, state.grants);
  }

  async getDocumentShares(
    actor: Actor,
    doctype: DocTypeDefinition,
    document: DocumentSnapshot
  ): Promise<DocumentShareState> {
    const state = await this.stateFor(document);
    const sharedPermissions = documentSharePermissionsForActor(actor, state.grants);
    if (!can(actor, doctype, "share", document) && !documentShareAllows(sharedPermissions, "share")) {
      throw permissionDenied(`Actor '${actor.id}' cannot manage shares for ${doctype.name}/${document.name}`);
    }
    return state;
  }

  private async stateFor(document: DocumentSnapshot): Promise<DocumentShareState> {
    return foldDocumentShares(
      document.tenantId,
      document.doctype,
      document.name,
      await this.events.readStream(documentStream(document.tenantId, document.doctype, document.name))
    );
  }
}
