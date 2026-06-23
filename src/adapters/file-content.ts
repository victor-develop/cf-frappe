import type { DownloadedFile, DownloadedFileRendition, TransformedFile } from "../application/file-service.js";

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

export function transformedFileContentHeaders(transformed: TransformedFile): Headers {
  const headers = new Headers();
  headers.set("content-type", transformed.transform.contentType);
  if (transformed.transform.contentLength !== undefined) {
    headers.set("content-length", String(transformed.transform.contentLength));
  }
  headers.set("x-content-type-options", "nosniff");
  if (transformed.transform.etag) {
    headers.set("etag", transformed.transform.etag);
  }
  const filenameValue = transformed.snapshot.data.filename;
  const filename = typeof filenameValue === "string" ? filenameValue : transformed.snapshot.name;
  headers.set("content-disposition", `inline; filename="${filename.replace(/["\\]/g, "_")}"`);
  return headers;
}

export function fileRenditionContentHeaders(downloaded: DownloadedFileRendition): Headers {
  const headers = new Headers();
  headers.set("content-type", downloaded.object.metadata.contentType ?? downloaded.rendition.contentType ?? "application/octet-stream");
  headers.set("content-length", String(downloaded.object.metadata.size));
  headers.set("x-content-type-options", "nosniff");
  if (downloaded.object.metadata.httpEtag) {
    headers.set("etag", downloaded.object.metadata.httpEtag);
  }
  const filenameValue = downloaded.object.metadata.filename;
  const filename = filenameValue ?? `${downloaded.snapshot.name}.${downloaded.rendition.id}`;
  headers.set("content-disposition", `inline; filename="${filename.replace(/["\\]/g, "_")}"`);
  return headers;
}
