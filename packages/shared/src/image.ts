/**
 * Only the types a provider turn accepts. A picture the provider would reject is still a
 * file, so widening this map would promote attachments the send path cannot carry.
 * Mirrors `PROVIDER_SEND_TURN_SUPPORTED_IMAGE_MIME_TYPES`.
 */
const IMAGE_MIME_TYPE_BY_EXTENSION = new Map([
  ["gif", "image/gif"],
  ["jpeg", "image/jpeg"],
  ["jpg", "image/jpeg"],
  ["png", "image/png"],
  ["webp", "image/webp"],
]);

const SUPPORTED_IMAGE_MIME_TYPES = new Set(IMAGE_MIME_TYPE_BY_EXTENSION.values());

export const IMAGE_FILE_EXTENSIONS = Object.freeze([...IMAGE_MIME_TYPE_BY_EXTENSION.keys()]);

/**
 * Recognizes pictures even when the picker omitted their MIME type. A picture chosen through
 * the document picker arrives typed as a plain file, so what it *is* has to come from its own
 * name and type rather than from which picker produced it.
 */
export function imageMimeType(attachment: {
  readonly name: string;
  readonly mimeType: string;
}): string | null {
  const mimeType = attachment.mimeType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (SUPPORTED_IMAGE_MIME_TYPES.has(mimeType)) return mimeType;
  // A declared but unsupported image type stays a file: the send path cannot carry it.
  if (mimeType.startsWith("image/")) return null;
  const dotIndex = attachment.name.lastIndexOf(".");
  return dotIndex < 0
    ? null
    : (IMAGE_MIME_TYPE_BY_EXTENSION.get(
        attachment.name
          .slice(dotIndex + 1)
          .trim()
          .toLowerCase(),
      ) ?? null);
}
