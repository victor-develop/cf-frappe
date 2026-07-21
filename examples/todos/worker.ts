import { SYSTEM_MANAGER_ROLE, type Actor } from "../../src";
import { createAggregateCoordinatorClass, createCloudFrappeWorker } from "../../src/cloudflare";
import { todoRegistry } from "./models";

const localDemoActor: Actor = {
  id: "demo-admin",
  roles: [SYSTEM_MANAGER_ROLE, "Task Manager", "User"],
  tenantId: "default"
};

export class ExampleAggregateCoordinator extends createAggregateCoordinatorClass({
  registry: todoRegistry
}) {}

export default createCloudFrappeWorker({
  registry: todoRegistry,
  actor: () => localDemoActor
});
