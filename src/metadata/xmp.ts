/**
 * XMP (APP1) generation for Motion Photo containers.
 *
 * Two flavours:
 * - `google` (default): the container metadata Google Photos reads. No device identity.
 * - `oplus` : adds the `OpCamera:` properties some OPPO/OnePlus/realme galleries
 *   look for. Opt-in, because it makes the file claim to come from a specific
 *   device — see README "Motion Photo metadata".
 */

import type { MetadataProfileName } from '../types.js';

const APP1 = 0xe1;
const XMP_NAMESPACE = 'http://ns.adobe.com/xap/1.0/\u0000';

export interface XmpOptions {
  profile: Exclude<MetadataProfileName, 'none'>;
  appName: string;
  width: number;
  height: number;
  /** Byte length of the embedded MP4. */
  videoLength: number;
  /** Presentation timestamp of the still frame, in microseconds. */
  presentationTimestampUs: number;
  extraAttributes?: Readonly<Record<string, string>>;
}

/** Escape a value for use inside an XML attribute. */
export function escapeXmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function buildXmpPacket(options: XmpOptions): string {
  const attributes: Array<[string, string]> = [
    ['GCamera:MotionPhoto', '1'],
    ['GCamera:MotionPhotoVersion', '1'],
    ['GCamera:MotionPhotoPresentationTimestampUs', String(options.presentationTimestampUs)],
  ];

  if (options.profile === 'oplus') {
    attributes.push(
      [
        'OpCamera:MotionPhotoPrimaryPresentationTimestampUs',
        String(options.presentationTimestampUs),
      ],
      ['OpCamera:MotionPhotoOwner', options.appName],
      ['OpCamera:OLivePhotoVersion', '2'],
      ['OpCamera:VideoLength', String(options.videoLength)],
    );
  }

  for (const [key, value] of Object.entries(options.extraAttributes ?? {})) {
    attributes.push([key, value]);
  }

  const namespaces = [
    'xmlns:GCamera="http://ns.google.com/photos/1.0/camera/"',
    'xmlns:Container="http://ns.google.com/photos/1.0/container/"',
    'xmlns:Item="http://ns.google.com/photos/1.0/container/item/"',
    ...(options.profile === 'oplus'
      ? ['xmlns:OpCamera="http://ns.oplus.com/photos/1.0/camera/"']
      : []),
  ];

  const propertyLines = attributes
    .map(([key, value]) => `      ${key}="${escapeXmlAttribute(value)}"`)
    .join('\n');

  return (
    '<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="pixel-reveal">\n' +
    '  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">\n' +
    '    <rdf:Description rdf:about=""\n' +
    `        ${namespaces.join('\n        ')}\n` +
    `${propertyLines}>\n` +
    '      <Container:Directory>\n' +
    '        <rdf:Seq>\n' +
    '          <rdf:li rdf:parseType="Resource">\n' +
    '            <Container:Item Item:Mime="image/jpeg" Item:Semantic="Primary"/>\n' +
    '          </rdf:li>\n' +
    '          <rdf:li rdf:parseType="Resource">\n' +
    `            <Container:Item Item:Mime="video/mp4" Item:Semantic="MotionPhoto" Item:Length="${options.videoLength}"/>\n` +
    '          </rdf:li>\n' +
    '        </rdf:Seq>\n' +
    '      </Container:Directory>\n' +
    '    </rdf:Description>\n' +
    '  </rdf:RDF>\n' +
    '</x:xmpmeta>'
  );
}

/** Wrap an XMP packet in its APP1 segment. */
export function buildXmpApp1(options: XmpOptions): Uint8Array {
  const packet = buildXmpPacket(options);
  const namespace = new TextEncoder().encode(XMP_NAMESPACE);
  const body = new TextEncoder().encode(packet);
  const payloadLength = namespace.length + body.length;
  const segment = new Uint8Array(4 + payloadLength);

  segment[0] = 0xff;
  segment[1] = APP1;
  segment[2] = ((payloadLength + 2) >> 8) & 0xff;
  segment[3] = (payloadLength + 2) & 0xff;
  segment.set(namespace, 4);
  segment.set(body, 4 + namespace.length);

  return segment;
}
