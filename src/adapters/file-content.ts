import type { DownloadedFile } from "../application/file-service.js";

export type FileContentDisposition = "attachment" | "inline";

export function fileContentHeaders(downloaded: DownloadedFile, disposition: FileContentDisposition): Headers {
  const headers = new Headers();
  headers.set("content-type", downloaded.object.metadata.contentType ?? "application/octet-stream");
  headers.set("content-length", String(downloaded.object.metadata.size));
  headers.set("x-content-type-options", "nosniff");
  if (downloaded.object.metadata.httpEtag) {
    headers.set("etag", downloaded.object.metadata.httpEtag);
  }
  const filenameValue = downloaded.snapshot.data.filename;
  const filename = typeof filenameValue === "string" ? filenameValue : downloaded.snapshot.name;
  headers.set("content-disposition", `${disposition}; filename="${filename.replace(/["\\]/g, "_")}"`);
  return headers;
}
