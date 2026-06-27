const PUBLIC_WEBSITE_HREF_PATTERN = /^\/(page|web|web-forms)\/[A-Za-z0-9][A-Za-z0-9._~%/-]*$/;

export function isSafeWebsiteHref(value: string): boolean {
  if (value.startsWith("/")) {
    return PUBLIC_WEBSITE_HREF_PATTERN.test(value) &&
      !value.includes("..") &&
      !value.includes("\\") &&
      !value.includes("?") &&
      !value.includes("#") &&
      !/\s/.test(value) &&
      hasNoEncodedDotSegments(value);
  }
  if (!value.startsWith("https://") && !value.startsWith("http://")) {
    return false;
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function hasNoEncodedDotSegments(value: string): boolean {
  const [, ...segments] = value.split("/");
  try {
    return segments.every((segment) => {
      const decoded = decodeURIComponent(segment).toLowerCase();
      return decoded !== "." && decoded !== "..";
    });
  } catch {
    return false;
  }
}
