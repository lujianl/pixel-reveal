/**
 * Minimal, generated EXIF (APP1) segment.
 *
 * The default metadata profile writes this instead of a vendor dump: a valid
 * little-endian TIFF block carrying only Orientation and ColorSpace. Nothing
 * here identifies a device, so the output is honest about what produced it.
 */

const APP1 = 0xe1;
const TIFF_HEADER_SIZE = 8;
const IFD_ENTRY_SIZE = 12;

/** Build `FF E1 <len> Exif\0\0 <TIFF>` with an IFD0 holding Orientation + ColorSpace. */
export function buildExifApp1(options: {
  width: number;
  height: number;
  orientation?: number;
}): Uint8Array {
  const entries = 2;
  const ifdSize = 2 + entries * IFD_ENTRY_SIZE + 4;
  const tiffSize = TIFF_HEADER_SIZE + ifdSize;
  const payloadSize = 6 + tiffSize; // 'Exif\0\0' + TIFF
  const segment = new Uint8Array(4 + payloadSize);

  segment[0] = 0xff;
  segment[1] = APP1;
  // Length counts itself but not the marker.
  segment[2] = ((payloadSize + 2) >> 8) & 0xff;
  segment[3] = (payloadSize + 2) & 0xff;

  let offset = 4;
  segment.set([0x45, 0x78, 0x69, 0x66, 0x00, 0x00], offset); // 'Exif\0\0'
  offset += 6;

  const view = new DataView(segment.buffer);
  segment[offset] = 0x49; // 'I' little-endian
  segment[offset + 1] = 0x49;
  view.setUint16(offset + 2, 42, true);
  view.setUint32(offset + 4, TIFF_HEADER_SIZE, true);
  offset += TIFF_HEADER_SIZE;

  view.setUint16(offset, entries, true);
  offset += 2;

  // Orientation (0x0112, SHORT) = 1 (top-left)
  view.setUint16(offset, 0x0112, true);
  view.setUint16(offset + 2, 3, true); // SHORT
  view.setUint32(offset + 4, 1, true);
  view.setUint16(offset + 8, clampOrientation(options.orientation), true);
  offset += IFD_ENTRY_SIZE;

  // ColorSpace (0xA001, SHORT) = 1 (sRGB)
  view.setUint16(offset, 0xa001, true);
  view.setUint16(offset + 2, 3, true);
  view.setUint32(offset + 4, 1, true);
  view.setUint16(offset + 8, 1, true);
  offset += IFD_ENTRY_SIZE;

  view.setUint32(offset, 0, true); // no next IFD

  return segment;
}

function clampOrientation(value: number | undefined): number {
  if (!Number.isInteger(value) || value === undefined || value < 1 || value > 8) return 1;
  return value;
}
