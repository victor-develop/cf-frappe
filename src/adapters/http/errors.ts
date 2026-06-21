import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { FrameworkError } from "../../core/errors";

export function toErrorResponse(error: unknown, c: Context): Response {
  if (error instanceof FrameworkError) {
    return c.json(
      {
        error: {
          code: error.code,
          message: error.message,
          issues: error.issues
      }
    },
      error.status as ContentfulStatusCode
    );
  }
  return c.json(
    {
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: error instanceof Error ? error.message : "Internal server error"
      }
    },
    500
  );
}
