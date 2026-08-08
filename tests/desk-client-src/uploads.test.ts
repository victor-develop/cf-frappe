import {
  collectNamespaceExtensions,
  hydratorRegistry,
  resetRegistries
} from "../../src/adapters/desk/client-src/boot";
import { HttpRequestError } from "../../src/adapters/desk/client-src/http";
import {
  MAX_MULTIPART_FILE_PARTS,
  MIN_MULTIPART_FILE_PART_BYTES
} from "../../src/adapters/desk/client-src/constants";
import {
  abortMultipartUpload,
  completeDirectUpload,
  completeMultipartUpload,
  hydrateFileUploadForms,
  prepareDirectUpload,
  prepareMultipartUpload,
  registerUploads,
  uploadDirectFile,
  uploadFile,
  uploadMultipartFile,
  uploadMultipartPart
} from "../../src/adapters/desk/client-src/uploads";

type FetchMock = ReturnType<typeof vi.fn>;

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function stubFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>): FetchMock {
  const mock = vi.fn((url: string, init: RequestInit) => Promise.resolve(handler(url, init)));
  vi.stubGlobal("fetch", mock);
  return mock;
}

function requestBodyOf(mock: FetchMock, call: number): unknown {
  const init = mock.mock.calls[call]?.[1] as RequestInit;
  return JSON.parse(String(init.body));
}

function requestUrlOf(mock: FetchMock, call: number): string {
  return String(mock.mock.calls[call]?.[0]);
}

function headerOf(mock: FetchMock, call: number, name: string): string | null {
  const init = mock.mock.calls[call]?.[1] as RequestInit;
  return new Headers(init.headers ?? {}).get(name);
}

async function settle(): Promise<void> {
  for (let i = 0; i < 3; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("uploads: files.upload", () => {
  it("posts the body to /api/files with camelCase params and content-type header", async () => {
    const mock = stubFetch(() => jsonResponse({ data: { name: "F1" } }));
    const result = await uploadFile("raw-bytes", {
      attachedTo: { doctype: "Task", name: "T 1" },
      filename: "a.txt",
      isPrivate: true,
      contentType: "text/plain"
    });
    expect(requestUrlOf(mock, 0)).toBe(
      "/api/files?attached_to_doctype=Task&attached_to_name=T+1&filename=a.txt&is_private=true"
    );
    const init = mock.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(init.body).toBe("raw-bytes");
    expect(headerOf(mock, 0, "content-type")).toBe("text/plain");
    expect(result).toEqual({ data: { name: "F1" } });
  });

  it("honors snake_case params and skips a null content_type header", async () => {
    const mock = stubFetch(() => jsonResponse({ data: {} }));
    await uploadFile("x", {
      attached_to_doctype: "Task",
      attached_to_name: "T1",
      is_private: false,
      content_type: null
    });
    expect(requestUrlOf(mock, 0)).toBe("/api/files?attached_to_doctype=Task&attached_to_name=T1&is_private=false");
    expect(headerOf(mock, 0, "content-type")).toBeNull();
  });

  it("posts without query params when no options are given", async () => {
    const mock = stubFetch(() => jsonResponse({ data: {} }));
    await uploadFile("x");
    expect(requestUrlOf(mock, 0)).toBe("/api/files");
  });

  it("preflights a known body size against maxUploadBytes", async () => {
    const mock = stubFetch(() => jsonResponse({ data: {} }));
    await expect(uploadFile({ size: 11 }, { maxUploadBytes: 10 })).rejects.toThrow("File exceeds 10 bytes");
    expect(mock).not.toHaveBeenCalled();
  });

  it("skips the preflight for unknown sizes and non-positive or fractional limits", async () => {
    const mock = stubFetch(() => jsonResponse({ data: {} }));
    await uploadFile({ size: Number.NaN }, { max_upload_bytes: 10 });
    await uploadFile({}, { maxUploadBytes: 10 });
    await uploadFile({ size: 11 }, { maxUploadBytes: 0 });
    await uploadFile({ size: 11 }, { maxUploadBytes: 10.5 });
    await uploadFile({ size: 11 }, { maxUploadBytes: null });
    expect(mock).toHaveBeenCalledTimes(5);
  });
});

describe("uploads: reservations", () => {
  it("prepareDirectUpload strips maxUploadBytes keys from the request body", async () => {
    const mock = stubFetch(() => jsonResponse({ data: { name: "F1" } }));
    await prepareDirectUpload({ filename: "a.txt", size: 4, maxUploadBytes: 10, max_upload_bytes: 10 });
    expect(requestUrlOf(mock, 0)).toBe("/api/files/direct-upload");
    expect(requestBodyOf(mock, 0)).toEqual({ filename: "a.txt", size: 4 });
  });

  it("prepareDirectUpload preflights the declared size and tolerates a missing input", async () => {
    const mock = stubFetch(() => jsonResponse({ data: {} }));
    await expect(prepareDirectUpload({ size: 11, maxUploadBytes: 10 })).rejects.toThrow("File exceeds 10 bytes");
    await prepareDirectUpload();
    expect(requestBodyOf(mock, 0)).toEqual({});
  });

  it("prepareMultipartUpload posts the reservation and preflights the declared size", async () => {
    const mock = stubFetch(() => jsonResponse({ data: {} }));
    await prepareMultipartUpload({ filename: "big.bin", size: 4 });
    expect(requestUrlOf(mock, 0)).toBe("/api/files/multipart-upload");
    expect(requestBodyOf(mock, 0)).toEqual({ filename: "big.bin", size: 4 });
    await expect(prepareMultipartUpload({ size: 11, maxUploadBytes: 10 })).rejects.toThrow("File exceeds 10 bytes");
    await prepareMultipartUpload();
    expect(requestBodyOf(mock, 1)).toEqual({});
  });
});

describe("uploads: lifecycle endpoints", () => {
  it("completeDirectUpload posts the version body and unwraps data", async () => {
    const mock = stubFetch(() => jsonResponse({ data: { name: "F 1" } }));
    const result = await completeDirectUpload("F 1", { expectedVersion: 3 });
    expect(requestUrlOf(mock, 0)).toBe("/api/files/F%201/complete-upload");
    expect(requestBodyOf(mock, 0)).toEqual({ expectedVersion: 3 });
    expect(result).toEqual({ name: "F 1" });
  });

  it("uploadMultipartPart PUTs the chunk and forwards the part size header", async () => {
    const mock = stubFetch(() => jsonResponse({ data: {}, part: { partNumber: 2 } }));
    await uploadMultipartPart("F1", 2, "chunk", { size: 5 });
    expect(requestUrlOf(mock, 0)).toBe("/api/files/F1/multipart-parts/2");
    const init = mock.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe("PUT");
    expect(init.body).toBe("chunk");
    expect(headerOf(mock, 0, "x-cf-frappe-part-size")).toBe("5");
    await uploadMultipartPart("F1", 3, "chunk");
    expect(headerOf(mock, 1, "x-cf-frappe-part-size")).toBeNull();
  });

  it("completeMultipartUpload posts parts with the version body and unwraps data", async () => {
    const mock = stubFetch(() => jsonResponse({ data: { version: 9 } }));
    const parts = [{ partNumber: 1, etag: "e1" }];
    const result = await completeMultipartUpload("F1", parts, { expectedVersion: 4 });
    expect(requestUrlOf(mock, 0)).toBe("/api/files/F1/complete-multipart-upload");
    expect(requestBodyOf(mock, 0)).toEqual({ parts: [{ partNumber: 1, etag: "e1" }], expectedVersion: 4 });
    expect(result).toEqual({ version: 9 });
  });

  it("abortMultipartUpload posts the version body and unwraps data", async () => {
    const mock = stubFetch(() => jsonResponse({ data: { aborted: true } }));
    const result = await abortMultipartUpload("F1");
    expect(requestUrlOf(mock, 0)).toBe("/api/files/F1/abort-multipart-upload");
    expect(requestBodyOf(mock, 0)).toEqual({});
    expect(result).toEqual({ aborted: true });
  });
});

describe("uploads: uploadDirectFile", () => {
  const reservation = {
    data: { name: "F1", version: 2 },
    upload: { url: "https://r2.example/put", method: "POST", headers: { "x-r2": "yes" } }
  };

  it("reserves, uploads to the returned URL and completes with the reserved version", async () => {
    const mock = stubFetch((url) => {
      if (url === "/api/files/direct-upload") {
        return jsonResponse(reservation);
      }
      if (url === "https://r2.example/put") {
        return new Response(null, { status: 200 });
      }
      return jsonResponse({ data: { name: "F1", version: 3 } });
    });
    const body = { size: 3, name: "a.txt", type: "text/plain" };
    const result = await uploadDirectFile(body, { maxUploadBytes: 100, isPrivate: true });
    expect(requestBodyOf(mock, 0)).toEqual({
      filename: "a.txt",
      size: 3,
      contentType: "text/plain",
      isPrivate: true,
    });
    expect(requestUrlOf(mock, 1)).toBe("https://r2.example/put");
    const putInit = mock.mock.calls[1]?.[1] as RequestInit;
    expect(putInit.method).toBe("POST");
    expect(putInit.body).toBe(body);
    expect((putInit.headers as Record<string, string>)["x-r2"]).toBe("yes");
    expect(requestUrlOf(mock, 2)).toBe("/api/files/F1/complete-upload");
    expect(requestBodyOf(mock, 2)).toEqual({ expectedVersion: 2 });
    expect(result).toEqual({ data: { name: "F1", version: 3 }, upload: reservation.upload });
  });

  it("defaults the upload method to PUT and the headers to an empty object", async () => {
    const mock = stubFetch((url) => {
      if (url === "/api/files/direct-upload") {
        return jsonResponse({ data: { name: "F1" }, upload: { url: "https://r2.example/put" } });
      }
      if (url === "https://r2.example/put") {
        return new Response(null, { status: 200 });
      }
      return jsonResponse({ data: { name: "F1" } });
    });
    await uploadDirectFile({ size: 1, name: "a" });
    const putInit = mock.mock.calls[1]?.[1] as RequestInit;
    expect(putInit.method).toBe("PUT");
    expect(requestBodyOf(mock, 2)).toEqual({});
  });

  it("derives snake_case reservation fields and the default content type", async () => {
    const mock = stubFetch((url) => {
      if (url === "/api/files/direct-upload") {
        return jsonResponse({ data: { name: "F1" }, upload: { url: "https://r2.example/put" } });
      }
      return url === "https://r2.example/put" ? new Response(null, { status: 200 }) : jsonResponse({ data: {} });
    });
    await uploadDirectFile(
      { size: 1 },
      {
        filename: "fallback.bin",
        attached_to_doctype: "Task",
        attached_to_name: "T1",
        is_private: false,
        expiresInSeconds: 60,
        max_upload_bytes: 50
      }
    );
    expect(requestBodyOf(mock, 0)).toEqual({
      filename: "fallback.bin",
      size: 1,
      contentType: "application/octet-stream",
      attached_to_doctype: "Task",
      attached_to_name: "T1",
      isPrivate: false,
      expiresInSeconds: 60,
    });
  });

  it("rejects bodies without a numeric size or a resolvable filename", async () => {
    stubFetch(() => jsonResponse({ data: {} }));
    await expect(uploadDirectFile({ name: "a.txt" })).rejects.toThrow("Multipart file body must expose a numeric size");
    await expect(uploadDirectFile({ size: 1, name: "" })).rejects.toThrow("filename is required for multipart uploads");
  });

  it("throws when the reservation lacks upload instructions", async () => {
    stubFetch(() => jsonResponse({ data: { name: "F1" } }));
    await expect(uploadDirectFile({ size: 1, name: "a" })).rejects.toThrow(
      "Direct upload reservation did not return upload instructions"
    );
    stubFetch(() => jsonResponse({ data: {}, upload: { url: "https://r2.example/put" } }));
    await expect(uploadDirectFile({ size: 1, name: "a" })).rejects.toThrow(
      "Direct upload reservation did not return upload instructions"
    );
    stubFetch(() => jsonResponse({ upload: { url: "https://r2.example/put" } }));
    await expect(uploadDirectFile({ size: 1, name: "a" })).rejects.toThrow(
      "Direct upload reservation did not return upload instructions"
    );
    stubFetch(() => jsonResponse({ data: { name: "F1" }, upload: {} }));
    await expect(uploadDirectFile({ size: 1, name: "a" })).rejects.toThrow(
      "Direct upload reservation did not return upload instructions"
    );
  });

  it("surfaces storage upload failures as HttpRequestError and never completes", async () => {
    const mock = stubFetch((url) => {
      if (url === "/api/files/direct-upload") {
        return jsonResponse(reservation);
      }
      return jsonResponse({ error: { message: "denied by bucket" } }, 403);
    });
    await expect(uploadDirectFile({ size: 1, name: "a" })).rejects.toThrow(HttpRequestError);
    expect(mock).toHaveBeenCalledTimes(2);
  });
});

describe("uploads: uploadMultipartFile", () => {
  function multipartBody(size: number): { size: number; name: string; type: string; slice: ReturnType<typeof vi.fn> } {
    return {
      size,
      name: "big.bin",
      type: "application/zip",
      slice: vi.fn((start: number, end: number) => `chunk:${start}-${end}`)
    };
  }

  it("chunks, tracks versions, reports progress and completes", async () => {
    const chunkSize = MIN_MULTIPART_FILE_PART_BYTES;
    const size = chunkSize + 2;
    const body = multipartBody(size);
    let part = 0;
    const mock = stubFetch((url) => {
      if (url === "/api/files/multipart-upload") {
        return jsonResponse({ data: { name: "F1", version: 1 }, upload: { id: "mp-1" } });
      }
      if (url.includes("/multipart-parts/")) {
        part += 1;
        return part === 1
          ? jsonResponse({ data: { name: "F1", version: 2 }, part: { partNumber: 1, etag: "e1" } })
          : jsonResponse({ data: { name: "F1" }, part: { partNumber: 2, etag: "e2" } });
      }
      return jsonResponse({ data: { name: "F1", version: 3 } });
    });
    const events: unknown[] = [];
    const result = await uploadMultipartFile(body, { onProgress: (event: unknown) => events.push(event) });
    expect(requestBodyOf(mock, 0)).toEqual({
      filename: "big.bin",
      size,
      contentType: "application/zip"
    });
    expect(requestUrlOf(mock, 1)).toBe("/api/files/F1/multipart-parts/1");
    expect(headerOf(mock, 1, "x-cf-frappe-part-size")).toBe(String(chunkSize));
    const firstPartInit = mock.mock.calls[1]?.[1] as RequestInit;
    expect(firstPartInit.body).toBe(`chunk:0-${chunkSize}`);
    expect(requestUrlOf(mock, 2)).toBe("/api/files/F1/multipart-parts/2");
    expect(headerOf(mock, 2, "x-cf-frappe-part-size")).toBe("2");
    expect(requestUrlOf(mock, 3)).toBe("/api/files/F1/complete-multipart-upload");
    expect(requestBodyOf(mock, 3)).toEqual({
      parts: [
        { partNumber: 1, etag: "e1" },
        { partNumber: 2, etag: "e2" }
      ],
      expectedVersion: 2
    });
    expect(events).toEqual([
      {
        file: { name: "F1", version: 1 },
        part: { partNumber: 1, etag: "e1" },
        partNumber: 1,
        totalParts: 2,
        uploadedBytes: chunkSize,
        totalBytes: size
      },
      {
        file: { name: "F1", version: 1 },
        part: { partNumber: 2, etag: "e2" },
        partNumber: 2,
        totalParts: 2,
        uploadedBytes: size,
        totalBytes: size
      }
    ]);
    expect(result).toEqual({
      data: { name: "F1", version: 3 },
      upload: { id: "mp-1" },
      parts: [
        { partNumber: 1, etag: "e1" },
        { partNumber: 2, etag: "e2" }
      ]
    });
  });

  it("allows a single small part and tolerates a missing progress callback", async () => {
    const body = { size: 3, name: "small.txt", type: "", slice: (start: number, end: number) => `c:${start}-${end}` };
    const mock = stubFetch((url) => {
      if (url === "/api/files/multipart-upload") {
        return jsonResponse({ data: { name: "F2" } });
      }
      if (url.includes("/multipart-parts/")) {
        return jsonResponse({ part: { partNumber: 1, etag: "e1" } });
      }
      return jsonResponse({ data: { done: true } });
    });
    const result = (await uploadMultipartFile(body, { chunkSize: 4 })) as { parts: unknown[] };
    expect(requestBodyOf(mock, 0)).toEqual({
      filename: "small.txt",
      size: 3,
      contentType: "application/octet-stream"
    });
    expect(requestBodyOf(mock, 2)).toEqual({ parts: [{ partNumber: 1, etag: "e1" }] });
    expect(result.parts).toEqual([{ partNumber: 1, etag: "e1" }]);
  });

  it("validates the chunk plan before reserving anything", async () => {
    const mock = stubFetch(() => jsonResponse({ data: {} }));
    const body = multipartBody(MIN_MULTIPART_FILE_PART_BYTES * 2);
    await expect(uploadMultipartFile(body, { chunkSize: 1.5 })).rejects.toThrow("chunkSize must be a positive integer");
    await expect(uploadMultipartFile(body, { chunkSize: 0 })).rejects.toThrow("chunkSize must be a positive integer");
    await expect(uploadMultipartFile(body, { chunkSize: 1024 })).rejects.toThrow(
      `chunkSize must be at least ${String(MIN_MULTIPART_FILE_PART_BYTES)} bytes for multi-part R2 uploads`
    );
    const huge = multipartBody(MIN_MULTIPART_FILE_PART_BYTES * (MAX_MULTIPART_FILE_PARTS + 1));
    await expect(uploadMultipartFile(huge)).rejects.toThrow(
      `Multipart upload cannot exceed ${String(MAX_MULTIPART_FILE_PARTS)} parts`
    );
    await expect(uploadMultipartFile(multipartBody(11), { chunkSize: 20, maxUploadBytes: 10 })).rejects.toThrow(
      "File exceeds 10 bytes"
    );
    expect(mock).not.toHaveBeenCalled();
  });

  it("throws when the reservation does not return a file name", async () => {
    stubFetch(() => jsonResponse({ data: {} }));
    await expect(uploadMultipartFile(multipartBody(3), { chunkSize: 4 })).rejects.toThrow(
      "Multipart upload reservation did not return a file name"
    );
  });

  it("aborts with the last known version when a part fails, swallowing abort failures", async () => {
    const urls: string[] = [];
    const mock = stubFetch((url) => {
      urls.push(url);
      if (url === "/api/files/multipart-upload") {
        return jsonResponse({ data: { name: "F3", version: 5 } });
      }
      if (url.includes("/multipart-parts/")) {
        return jsonResponse({ error: { message: "part failed" } }, 500);
      }
      return jsonResponse({ error: { message: "abort failed" } }, 500);
    });
    await expect(uploadMultipartFile(multipartBody(3), { chunkSize: 4 })).rejects.toThrow("part failed");
    expect(urls[2]).toBe("/api/files/F3/abort-multipart-upload");
    expect(requestBodyOf(mock, 2)).toEqual({ expectedVersion: 5 });
  });

  it("skips the abort when abortOnError is false", async () => {
    const urls: string[] = [];
    stubFetch((url) => {
      urls.push(url);
      if (url === "/api/files/multipart-upload") {
        return jsonResponse({ data: { name: "F3" } });
      }
      return jsonResponse({ error: { message: "part failed" } }, 500);
    });
    await expect(uploadMultipartFile(multipartBody(3), { chunkSize: 4, abortOnError: false })).rejects.toThrow(
      "part failed"
    );
    expect(urls).toEqual(["/api/files/multipart-upload", "/api/files/F3/multipart-parts/1"]);
  });

  it("does not abort when the completion call itself fails", async () => {
    const urls: string[] = [];
    stubFetch((url) => {
      urls.push(url);
      if (url === "/api/files/multipart-upload") {
        return jsonResponse({ data: { name: "F3" } });
      }
      if (url.includes("/multipart-parts/")) {
        return jsonResponse({ part: { partNumber: 1 } });
      }
      return jsonResponse({ error: { message: "complete failed" } }, 409);
    });
    await expect(uploadMultipartFile(multipartBody(3), { chunkSize: 4 })).rejects.toThrow("complete failed");
    expect(urls).toEqual([
      "/api/files/multipart-upload",
      "/api/files/F3/multipart-parts/1",
      "/api/files/F3/complete-multipart-upload"
    ]);
  });

  it("aborts when the body cannot be sliced", async () => {
    const urls: string[] = [];
    stubFetch((url) => {
      urls.push(url);
      return jsonResponse({ data: { name: "F4" } });
    });
    await expect(uploadMultipartFile({ size: 3, name: "x" }, { chunkSize: 4 })).rejects.toThrow(
      "Multipart file body must support slice(start, end)"
    );
    expect(urls).toEqual(["/api/files/multipart-upload", "/api/files/F4/abort-multipart-upload"]);
  });
});

describe("uploads: registration", () => {
  it("registers the upload-form hydrator and the files namespace contribution", () => {
    resetRegistries();
    registerUploads();
    const registrations = hydratorRegistry.list();
    expect(registrations).toHaveLength(1);
    expect(registrations[0]?.name).toBe("file-upload-forms");
    expect(registrations[0]?.hydrate).toBe(hydrateFileUploadForms);
    const extensions = collectNamespaceExtensions();
    expect(extensions.files).toBeDefined();
    const files = extensions.files ?? {};
    expect(files.upload).toBe(uploadFile);
    expect(files.uploadDirect).toBe(uploadDirectFile);
    expect(files.uploadMultipart).toBe(uploadMultipartFile);
    expect(files.uploadMultipartPart).toBe(uploadMultipartPart);
    expect(files.prepareDirectUpload).toBe(prepareDirectUpload);
    expect(files.prepareMultipartUpload).toBe(prepareMultipartUpload);
    expect(files.completeDirectUpload).toBe(completeDirectUpload);
    expect(files.completeMultipartUpload).toBe(completeMultipartUpload);
    expect(files.abortMultipartUpload).toBe(abortMultipartUpload);
    resetRegistries();
  });
});

describe("uploads: file upload form hydration", () => {
  interface FormFixtureOptions {
    className?: string;
    maxFileBytes?: string;
    uploadMode?: string;
    attachedToDoctype?: string;
    attachedToName?: string;
    successUrl?: string;
    withFileInput?: boolean;
    withCheckbox?: boolean;
    checkboxChecked?: boolean;
    extraInputs?: string;
  }

  function installForm(options: FormFixtureOptions = {}): HTMLFormElement {
    const form = document.createElement("form");
    form.className = options.className ?? "panel form file-upload";
    form.setAttribute("method", "post");
    form.setAttribute("action", "/desk/files");
    form.setAttribute("enctype", "multipart/form-data");
    form.setAttribute("data-max-file-bytes", options.maxFileBytes ?? "100");
    if (options.uploadMode !== undefined) {
      form.setAttribute("data-upload-mode", options.uploadMode);
    }
    if (options.attachedToDoctype !== undefined) {
      form.setAttribute("data-attached-to-doctype", options.attachedToDoctype);
    }
    if (options.attachedToName !== undefined) {
      form.setAttribute("data-attached-to-name", options.attachedToName);
    }
    if (options.successUrl !== undefined) {
      form.setAttribute("data-success-url", options.successUrl);
    }
    form.innerHTML = `${options.withFileInput === false ? "" : '<input name="file" type="file" required />'}${
      options.withCheckbox === false
        ? ""
        : `<input name="is_private" type="checkbox" value="1"${options.checkboxChecked === false ? "" : " checked"} />`
    }${options.extraInputs ?? ""}<button class="button primary" type="submit">Upload</button>`;
    document.body.appendChild(form);
    return form;
  }

  function setFiles(form: HTMLFormElement, files: unknown[]): HTMLInputElement {
    const input = form.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, "files", { value: files, configurable: true });
    return input;
  }

  function submit(form: HTMLFormElement): Event {
    const event = new Event("submit", { bubbles: true, cancelable: true });
    form.dispatchEvent(event);
    return event;
  }

  function reservationFetch(): FetchMock {
    return stubFetch((url) => {
      if (url === "/api/files/direct-upload") {
        return jsonResponse({
          data: { name: "F1", version: 2 },
          upload: { url: "https://r2.example/put", method: "PUT", headers: {} }
        });
      }
      if (url === "https://r2.example/put") {
        return new Response(null, { status: 200 });
      }
      return jsonResponse({ data: { name: "F1", version: 3 } });
    });
  }

  it("hydrates file-upload and attachment-upload forms exactly once", () => {
    const uploadForm = installForm();
    const attachmentForm = installForm({ className: "form attachment-upload" });
    const other = installForm({ className: "form list-filters" });
    hydrateFileUploadForms();
    hydrateFileUploadForms();
    const addEventListener = vi.fn();
    expect((uploadForm as unknown as Record<string, unknown>).__cfFrappeFileUploadHydrated).toBe(true);
    expect((attachmentForm as unknown as Record<string, unknown>).__cfFrappeFileUploadHydrated).toBe(true);
    expect((other as unknown as Record<string, unknown>).__cfFrappeFileUploadHydrated).toBeUndefined();
    expect(addEventListener).not.toHaveBeenCalled();
    const alertSpy = vi.fn();
    vi.stubGlobal("alert", alertSpy);
    setFiles(uploadForm, [{ size: 500, name: "big.txt", type: "text/plain" }]);
    submit(uploadForm);
    expect(alertSpy).toHaveBeenCalledTimes(1);
  });

  it("lets submits without a selected file proceed and clears validity", () => {
    const form = installForm();
    const input = setFiles(form, []);
    const setValidity = vi.spyOn(input, "setCustomValidity");
    hydrateFileUploadForms();
    const event = submit(form);
    expect(event.defaultPrevented).toBe(false);
    expect(setValidity).toHaveBeenCalledWith("");
  });

  it("ignores forms without any file input", () => {
    const form = installForm({ withFileInput: false, withCheckbox: false });
    hydrateFileUploadForms();
    const event = submit(form);
    expect(event.defaultPrevented).toBe(false);
  });

  it("blocks oversize files, reports validity and prints the message", () => {
    const mock = stubFetch(() => jsonResponse({ data: {} }));
    const alertSpy = vi.fn();
    vi.stubGlobal("alert", alertSpy);
    const form = installForm({ uploadMode: "direct" });
    const input = setFiles(form, [{ size: 101, name: "big.txt", type: "text/plain" }]);
    const setValidity = vi.spyOn(input, "setCustomValidity");
    const report = vi.spyOn(input, "reportValidity").mockImplementation(() => true);
    hydrateFileUploadForms();
    const event = submit(form);
    expect(event.defaultPrevented).toBe(true);
    expect(setValidity).toHaveBeenCalledWith("File exceeds 100 bytes");
    expect(report).toHaveBeenCalledTimes(1);
    expect(alertSpy).toHaveBeenCalledWith("File exceeds 100 bytes");
    expect(mock).not.toHaveBeenCalled();
  });

  it("skips the size gate when the size or the limit is unusable", () => {
    const alertSpy = vi.fn();
    vi.stubGlobal("alert", alertSpy);
    const noLimit = installForm({ maxFileBytes: "not-a-number" });
    setFiles(noLimit, [{ size: 10_000, name: "big.txt", type: "text/plain" }]);
    const noSize = installForm({ maxFileBytes: "100" });
    setFiles(noSize, [{ name: "odd.txt", type: "text/plain" }]);
    const infinite = installForm({ maxFileBytes: "100" });
    setFiles(infinite, [{ size: Number.POSITIVE_INFINITY, name: "inf.txt", type: "text/plain" }]);
    hydrateFileUploadForms();
    expect(submit(noLimit).defaultPrevented).toBe(false);
    expect(submit(noSize).defaultPrevented).toBe(false);
    expect(submit(infinite).defaultPrevented).toBe(false);
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("leaves non-direct forms to their native submission", () => {
    const mock = stubFetch(() => jsonResponse({ data: {} }));
    const form = installForm();
    setFiles(form, [{ size: 3, name: "a.txt", type: "text/plain" }]);
    hydrateFileUploadForms();
    const event = submit(form);
    expect(event.defaultPrevented).toBe(false);
    expect(mock).not.toHaveBeenCalled();
  });

  it("intercepts direct uploads, sends dataset attachment context and redirects to the success URL", async () => {
    const mock = reservationFetch();
    const form = installForm({
      className: "form attachment-upload",
      uploadMode: "direct",
      attachedToDoctype: "Task",
      attachedToName: "T1",
      successUrl: "/desk/tasks/T1?uploaded=1"
    });
    setFiles(form, [{ size: 3, name: "a.txt", type: "text/plain" }]);
    hydrateFileUploadForms();
    const event = submit(form);
    expect(event.defaultPrevented).toBe(true);
    await settle();
    expect(requestBodyOf(mock, 0)).toEqual({
      filename: "a.txt",
      size: 3,
      contentType: "text/plain",
      attached_to_doctype: "Task",
      attached_to_name: "T1",
      isPrivate: true,
    });
    expect(requestUrlOf(mock, 2)).toBe("/api/files/F1/complete-upload");
    expect(window.location.href).toContain("/desk/tasks/T1?uploaded=1");
  });

  it("falls back to form controls for attachment context, filename and privacy", async () => {
    const mock = reservationFetch();
    const form = installForm({
      uploadMode: "direct",
      checkboxChecked: false,
      extraInputs:
        '<input name="filename" value="fallback.bin" />' +
        '<input name="attached_to_doctype" value="Doc" />' +
        '<input name="attached_to_name" value="D1" />'
    });
    setFiles(form, [{ size: 3, name: "", type: "" }]);
    hydrateFileUploadForms();
    submit(form);
    await settle();
    expect(requestBodyOf(mock, 0)).toEqual({
      filename: "fallback.bin",
      size: 3,
      contentType: "application/octet-stream",
      attached_to_doctype: "Doc",
      attached_to_name: "D1",
      isPrivate: false,
    });
  });

  it("omits attachment context and privacy when the form has no such controls", async () => {
    const mock = reservationFetch();
    const form = installForm({
      uploadMode: "direct",
      withCheckbox: false,
      extraInputs: '<input name="attached_to_doctype" value="" />'
    });
    setFiles(form, [{ size: 3, name: "a.txt", type: "text/plain" }]);
    hydrateFileUploadForms();
    submit(form);
    await settle();
    expect(requestBodyOf(mock, 0)).toEqual({
      filename: "a.txt",
      size: 3,
      contentType: "text/plain",
    });
  });

  it("redirects to the current location when no success URL is configured", async () => {
    reservationFetch();
    const before = window.location.href;
    const form = installForm({ uploadMode: "direct" });
    setFiles(form, [{ size: 3, name: "a.txt", type: "text/plain" }]);
    hydrateFileUploadForms();
    submit(form);
    await settle();
    expect(window.location.href).toBe(before);
  });

  it("reports upload errors through validity and msgprint and resets the in-flight flag", async () => {
    const alertSpy = vi.fn();
    vi.stubGlobal("alert", alertSpy);
    const mock = stubFetch(() => jsonResponse({ error: { message: "quota exceeded" } }, 403));
    const form = installForm({ uploadMode: "direct" });
    const input = setFiles(form, [{ size: 3, name: "a.txt", type: "text/plain" }]);
    const setValidity = vi.spyOn(input, "setCustomValidity");
    const report = vi.spyOn(input, "reportValidity").mockImplementation(() => true);
    hydrateFileUploadForms();
    submit(form);
    await settle();
    expect(setValidity).toHaveBeenCalledWith("quota exceeded");
    expect(report).toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith("quota exceeded");
    expect(mock).toHaveBeenCalledTimes(1);
    submit(form);
    await settle();
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it("stringifies errors without a message", async () => {
    const alertSpy = vi.fn();
    vi.stubGlobal("alert", alertSpy);
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject("boom"))
    );
    const form = installForm({ uploadMode: "direct" });
    setFiles(form, [{ size: 3, name: "a.txt", type: "text/plain" }]);
    hydrateFileUploadForms();
    submit(form);
    await settle();
    expect(alertSpy).toHaveBeenCalledWith("boom");
  });

  it("ignores concurrent submits while an upload is in flight", async () => {
    let release: (response: Response) => void = () => {};
    const gate = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const mock = vi.fn((url: string) => {
      if (url === "/api/files/direct-upload") {
        return gate;
      }
      if (url === "https://r2.example/put") {
        return Promise.resolve(new Response(null, { status: 200 }));
      }
      return Promise.resolve(jsonResponse({ data: { name: "F1" } }));
    });
    vi.stubGlobal("fetch", mock);
    const form = installForm({ uploadMode: "direct", successUrl: "/desk/files?done=1" });
    setFiles(form, [{ size: 3, name: "a.txt", type: "text/plain" }]);
    hydrateFileUploadForms();
    expect(submit(form).defaultPrevented).toBe(true);
    expect(submit(form).defaultPrevented).toBe(true);
    expect(mock).toHaveBeenCalledTimes(1);
    release(
      jsonResponse({
        data: { name: "F1", version: 1 },
        upload: { url: "https://r2.example/put" }
      })
    );
    await settle();
    expect(mock).toHaveBeenCalledTimes(3);
  });

  it("tolerates file inputs without validity APIs", () => {
    const form = installForm({ uploadMode: "direct" });
    const input = setFiles(form, [{ size: 500, name: "big.txt", type: "text/plain" }]);
    Object.defineProperty(input, "setCustomValidity", { value: undefined, configurable: true });
    Object.defineProperty(input, "reportValidity", { value: undefined, configurable: true });
    const alertSpy = vi.fn();
    vi.stubGlobal("alert", alertSpy);
    hydrateFileUploadForms();
    const event = submit(form);
    expect(event.defaultPrevented).toBe(true);
    expect(alertSpy).toHaveBeenCalledWith("File exceeds 100 bytes");
  });
});
