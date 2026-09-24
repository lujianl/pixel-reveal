/**
 * Demo UI strings. The library itself only localises effect labels; everything
 * here belongs to this demo.
 */

export const LOCALES = ['en', 'zh'] as const;
export type Locale = (typeof LOCALES)[number];

type Messages = Record<string, string>;

const en: Messages = {
  lede: 'Drop in a photo, pick a reveal, export a Motion Photo that plays in your camera roll. Everything happens on this device.',
  dropLabel: 'Choose a photo',
  dropHint: 'or drop one here · JPG, PNG, WebP',
  change: 'Change photo',
  effect: 'Effect',
  export: 'Export Motion Photo',
  shuffle: 'Shuffle',
  download: 'Download .jpg',
  settings: 'Settings',
  duration: 'Duration (s)',
  fps: 'Frames per second',
  blockSize: 'Block size (0 = auto)',
  maxDimension: 'Max dimension (px)',
  seed: 'Random seed',
  cover: 'Cover frame',
  coverEffect: 'First animation frame',
  coverOriginal: 'Original photo',
  metadata: 'Metadata profile',
  profileGoogle: 'Google Motion Photo (default)',
  profileOplus: 'OPPO / OnePlus flavour',
  profileNone: 'No Motion Photo metadata',
  noteGoogle: 'Generic Google Motion Photo metadata. No device identity is written.',
  noteOplus:
    'Writes a real OPPO device fingerprint into the file. Only use this if a specific gallery refuses the default.',
  noteNone:
    'The MP4 is appended but no container metadata is written, so most galleries will show a still.',
  appName: 'App name in metadata',
  privacy: 'No uploads, no analytics, no runtime dependencies',
  license: 'MIT licensed',
  decoding: 'Decoding…',
  encoding: 'Encoding frame {frame} / {total}',
  assembling: 'Assembling…',
  done: 'Done in {seconds}s',
  failed: 'Export failed: {message}',
  unsupported:
    'This browser cannot encode video (WebCodecs VideoEncoder is missing). Try Chrome 94+ or Edge 94+ on desktop.',
  tooLarge: 'That image is too large to decode here.',
  diagSize: 'Output',
  diagFrames: 'Frames',
  diagCodec: 'Codec',
  diagBitrate: 'Bitrate',
  diagVideo: 'Video payload',
  diagFile: 'File size',
  diagChecks: 'Structure',
  yes: 'ok',
  no: 'missing',
};

const zh: Messages = {
  lede: '拖入一张照片，选一种揭示动画，导出一张能在手机相册里播放的实况照片。',
  dropLabel: '选择照片',
  dropHint: '或把图片拖到这里 · JPG、PNG、WebP',
  change: '换一张图',
  effect: '效果',
  export: '导出实况照片',
  shuffle: '换一组随机',
  download: '下载 .jpg',
  settings: '参数设置',
  duration: '时长（秒）',
  fps: '帧率',
  blockSize: '像素块大小（0 = 自动）',
  maxDimension: '最长边上限（px）',
  seed: '随机种子',
  cover: '封面帧',
  coverEffect: '动画首帧',
  coverOriginal: '原始照片',
  metadata: '元数据方案',
  profileGoogle: 'Google 实况照片（默认）',
  profileOplus: 'OPPO / 一加 风格',
  profileNone: '不写实况照片元数据',
  noteGoogle: '写入通用的 Google 实况照片元数据，不包含任何设备标识。',
  noteOplus: '会把一台真实 OPPO 设备的指纹写进文件。仅在默认方案被某个相册拒绝时才使用。',
  noteNone: '仍会追加 MP4，但不写容器元数据，多数相册只会当作静态图显示。',
  appName: '元数据里的应用名',
  privacy: '零运行时依赖',
  license: 'MIT 许可',
  decoding: '正在解码…',
  encoding: '正在编码第 {frame} / {total} 帧',
  assembling: '正在组装…',
  done: '{seconds} 秒完成',
  failed: '导出失败：{message}',
  unsupported:
    '当前浏览器无法编码视频（缺少 WebCodecs VideoEncoder）。请在桌面端使用 Chrome 94+ 或 Edge 94+。',
  tooLarge: '这张图片太大，无法在这里解码。',
  diagSize: '输出尺寸',
  diagFrames: '帧数',
  diagCodec: '编码格式',
  diagBitrate: '码率',
  diagVideo: '视频体积',
  diagFile: '文件体积',
  diagChecks: '结构自检',
  yes: '正常',
  no: '缺失',
};

const catalog: Record<Locale, Messages> = { en, zh };

const STORAGE_KEY = 'pixel-reveal:locale';

export function detectStartLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'zh') return saved;
  } catch {
    /* storage may be unavailable */
  }
  const language =
    typeof navigator !== 'undefined' && typeof navigator.language === 'string'
      ? navigator.language.toLowerCase()
      : 'en';
  return language.startsWith('zh') ? 'zh' : 'en';
}

export function rememberLocale(locale: Locale): void {
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    /* ignore */
  }
  document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
}

export function translator(locale: Locale) {
  const table = catalog[locale];
  const fallback = catalog.en;
  return function t(key: string, values?: Record<string, string | number>): string {
    let text = table[key] ?? fallback[key] ?? key;
    if (values) {
      for (const [name, value] of Object.entries(values)) {
        text = text.replaceAll(`{${name}}`, String(value));
      }
    }
    return text;
  };
}

export type Translate = ReturnType<typeof translator>;

/** Fill every `data-i18n` node in the document. */
export function applyStaticTranslations(t: Translate): void {
  for (const node of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
    const key = node.dataset.i18n;
    if (key) node.textContent = t(key);
  }
}
