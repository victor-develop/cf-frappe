import {
  CHILD_TABLE_ROW_INDEX_FIELD,
  MAX_MULTIPART_FILE_PARTS,
  MIN_MULTIPART_FILE_PART_BYTES
} from "../../src/adapters/desk/client-src/constants";
import { CHILD_TABLE_ROW_INDEX_FIELD as SERVER_CHILD_TABLE_ROW_INDEX_FIELD } from "../../src/core/types";
import {
  MAX_MULTIPART_FILE_PARTS as SERVER_MAX_MULTIPART_FILE_PARTS,
  MIN_MULTIPART_FILE_PART_BYTES as SERVER_MIN_MULTIPART_FILE_PART_BYTES
} from "../../src/ports/file-storage";

describe("client-src constants drift guard", () => {
  it("keeps the child table row index field in sync with the server", () => {
    expect(CHILD_TABLE_ROW_INDEX_FIELD).toBe(SERVER_CHILD_TABLE_ROW_INDEX_FIELD);
  });

  it("keeps multipart upload limits in sync with the server", () => {
    expect(MIN_MULTIPART_FILE_PART_BYTES).toBe(SERVER_MIN_MULTIPART_FILE_PART_BYTES);
    expect(MAX_MULTIPART_FILE_PARTS).toBe(SERVER_MAX_MULTIPART_FILE_PARTS);
  });
});
