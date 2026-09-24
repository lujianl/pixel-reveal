/**
 * Binary metadata segments, base64-encoded.
 *
 * Each constant decodes to a complete JPEG marker segment (marker + length +
 * payload), so assembly is a plain concatenation.
 *
 * - `SRGB_ICC` and `MPF` are generic: a Google-authored sRGB profile and a
 *   Multi-Picture-Format skeleton. No device identity.
 * - `OPLUS_EXIF` is NOT generic. It is an EXIF blob lifted from a real
 *   OPPO/OnePlus Motion Photo and carries that device's fingerprint
 *   (app version, product code, a fixed video id, an OPPO user tag).
 *   It is only used by the opt-in `'oplus'` metadata profile — see README
 *   "Motion Photo metadata" before enabling it.
 */

/** sRGB ICC profile (APP2), authored by Google Inc. */
export const SRGB_ICC_BASE64 =
  '/+IB2ElDQ19QUk9GSUxFAAEBAAAByAAAAAAEMAAAbW50clJHQiBYWVogB+AAAQABAAAAAAAAYWNzcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAPbWAAEAAAAA0y0AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAJZGVzYwAAAPAAAAAkclhZWgAAARQAAAAUZ1hZWgAAASgAAAAUYlhZWgAAATwAAAAUd3RwdAAAAVAAAAAUclRSQwAAAWQAAAAoZ1RSQwAAAWQAAAAoYlRSQwAAAWQAAAAoY3BydAAAAYwAAAA8bWx1YwAAAAAAAAABAAAADGVuVVMAAAAIAAAAHABzAFIARwBCWFlaIAAAAAAAAG+iAAA49QAAA5BYWVogAAAAAAAAYpkAALeFAAAY2lhZWiAAAAAAAAAkoAAAD4QAALbPWFlaIAAAAAAAAPbWAAEAAAAA0y1wYXJhAAAAAAAEAAAAAmZmAADypwAADVkAABPQAAAKWwAAAAAAAAAAbWx1YwAAAAAAAAABAAAADGVuVVMAAAAgAAAAHABHAG8AbwBnAGwAZQAgAEkAbgBjAC4AIAAyADAAMQA2';

/** Multi-Picture Format skeleton (APP2). */
export const MPF_BASE64 =
  '/+IASE1QRgBNTQAqAAAACAADsAAABwAAAAQwMTAwsAEABAAAAAEAAAABsAIABwAAABAAAAAyAAAAAAADAAAAKiNVAAAAAAAAAAA=';

/** EXIF (APP1) from a real OPPO/OnePlus device dump — opt-in profile only. */
export const OPLUS_EXIF_BASE64 =
  '/+EDmkV4aWYAAE1NACoAAAAIAAQBAAAEAAAAAQAACHABAQAEAAAAAQAADwCHaQAEAAAAAQAAAD4BEgAEAAAAAQAAAAAAAAAAAAKShgAHAAADNgAAAFySCAAEAAAAAQAAAAAAAAAAQVNDSUkAAAB7ImRhdGEiOnsiYXBwVmVyc2lvbiI6IjAxLjAuMCIsImNhcGFiaWxpdHlOYW1lIjoicGl4ZWxfbWVsdF9waG90b3MiLCJkaWQiOiJvcndlcHV1cHR5cmVldXEiLCJlZGl0U291cmNlIjoiIiwiZWRpdFR5cGUiOiJlZGl0IiwiZWZmZWN0X2lkIjoibGl2ZV9waG90b19leHBvcnQiLCJlZmZlY3RfdHlwZSI6InRvb2wiLCJlbnRlckZyb20iOiIiLCJleHBvcnRUeXBlIjoiZXhwb3J0IiwiZXh0ZW5kVGVtcGxhdGVJZCI6IiIsImV4dGVuZFRlbXBsYXRlVHlwZSI6MCwiZmlyc3RMYXVuY2hNZXRob2QiOiJlbnRlcl9sYXVuY2giLCJnbG9iYWxfZGF0YV9mb3JfbWV0YWRhdGFfd3JpdGUiOiIiLCJpbmZvU3RpY2tlcklkIjoiIiwibGF1bmNoTW9kZSI6ImxhdW5jaCIsImxvY2tfY250X2xpc3QiOiIiLCJtb3ZpZTNkVGV4dFRlbXBsYXRlSWQiOiIiLCJvcGx1c3RhZyI6ODM4ODYwOCwib3MiOiJhbmRyb2lkIiwicHJvZHVjdCI6InhzIiwicm9vbV9pZCI6IiIsInNsb3dNb3Rpb24iOiJub25lIiwic3RpY2tlcklkIjoiIiwidGVtcGxhdGVJZCI6IiIsInRoZW1lX3BhcmFtcyI6IiIsInRyYW5zZmVyTWV0aG9kIjoiIiwidmlkZW9FZmZlY3RJZCI6IiIsInZpZGVvSWQiOiJmMTE2MGZiMS04YTJjLTRmZWMtODI4Yy00Y2Q0ZjdlNzE4ODQiLCJ2aWRlb1BhcmFtcyI6eyJzdCI6MCwiZWYiOjAsImJlIjowLCJ0eCI6MCwibXUiOjAsImZ0IjowLCJ0ZSI6MCwicmUiOjAsIm1hIjowLCJ2IjowLCJtZSI6MCwidnMiOjAsInNwIjowfX0sImhhc19jb3ZlciI6IjAiLCJvcGx1c3RhZyI6ODM4ODYwOCwic291cmNlX3R5cGUiOiJwaXhlbF9yZXZlYWxfZ2VuIn0A';

/** Decode standard base64 into bytes. */
export function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
