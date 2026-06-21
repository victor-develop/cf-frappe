import { createAggregateCoordinatorClass, createCloudFrappeWorker, type Actor } from "../../src";
import { todoRegistry } from "./models";

const readOnlyDemoActor: Actor = {
  id: "demo",
  roles: ["Guest"],
  tenantId: "default"
};

export class ExampleAggregateCoordinator extends createAggregateCoordinatorClass({
  registry: todoRegistry
}) {}

export default createCloudFrappeWorker({
  registry: todoRegistry,
  actor: () => readOnlyDemoActor
});
