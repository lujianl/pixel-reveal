/**
 * Minimal workbench around the library.
 *
 * Deliberately small: one drop target, one effect strip, one export button, and
 * a disclosure for the knobs. Everything the demo shows is a plain option on
 * `createMotionPhoto()`.
 */

import './style.css';

import {
  createMotionPhoto,
  createPreview,
  effectText,
  frameToImageData,
  inspectMotionPhoto,
  listEffects,
  supportsMotionPhotoExport,
  type EffectDefinition,
  type PreviewSession,
  type ProgressEvent,
} from '../src/index.js';

import {
  applyStaticTranslations,
  detectStartLocale,
  rememberLocale,
  translator,
  type Locale,
  type Translate,
} from './i18n.js';

/** Small size for a responsive preview; the export decodes again at full size. */
const PREVIEW_MAX_DIMENSION = 720;
const HOLD_AFTER_REVEAL_MS = 700;

const $ = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing element #${id}`);
  return node as T;
};

const drop = $<HTMLElement>('drop');
const fileInput = $<HTMLInputElement>('file');
const workbench = $<HTMLElement>('workbench');
const stageSize = $<HTMLElement>('stage-size');
const canvas = $<HTMLCanvasElement>('preview');
const effectsHost = $<HTMLElement>('effects');
const exportButton = $<HTMLButtonElement>('export');
const shuffleButton = $<HTMLButtonElement>('shuffle');
const localeButton = $<HTMLButtonElement>('locale');
const progressBox = $<HTMLElement>('progress');
const progressFill = $<HTMLElement>('progress-fill');
const progressText = $<HTMLElement>('progress-text');
const resultBox = $<HTMLElement>('result');
const downloadLink = $<HTMLAnchorElement>('download');
const diagnostics = $<HTMLElement>('diagnostics');
const profileNote = $<HTMLElement>('profile-note');

const durationInput = $<HTMLInputElement>('duration');
const fpsInput = $<HTMLInputElement>('fps');
const blockSizeInput = $<HTMLInputElement>('blockSize');
const maxDimensionInput = $<HTMLInputElement>('maxDimension');
const seedInput = $<HTMLInputElement>('seed');
const coverSelect = $<HTMLSelectElement>('cover');
const profileSelect = $<HTMLSelectElement>('profile');
const appNameInput = $<HTMLInputElement>('appName');

let locale: Locale = detectStartLocale();
let t: Translate = translator(locale);
const effects: EffectDefinition[] = listEffects();
let selectedEffect = effects[0]!;

let source: Blob | null = null;
let sourceSize: { width: number; height: number } | null = null;
let session: PreviewSession | null = null;
let rebuildToken = 0;
let animationFrame: number | null = null;
let objectUrl: string | null = null;
const canExport = supportsMotionPhotoExport();

function defaultsFrom(effect: EffectDefinition): void {
  durationInput.value = String(effect.duration ?? 2.5);
  fpsInput.value = '30';
  blockSizeInput.value = '0';
  maxDimensionInput.value = '2560';
  seedInput.value = '1';
  appNameInput.value = 'pixel-reveal';
}

function currentOptions() {
  const blockSize = Number(blockSizeInput.value);
  return {
    effect: selectedEffect,
    duration: Number(durationInput.value) || undefined,
    fps: Number(fpsInput.value) || undefined,
    maxDimension: Number(maxDimensionInput.value) || undefined,
    seed: Number(seedInput.value) || 1,
    cover: coverSelect.value === 'original' ? ('original' as const) : ('effect' as const),
    metadata: {
      profile: profileSelect.value as 'google' | 'oplus' | 'none',
      appName: appNameInput.value || 'pixel-reveal',
    },
    ...(blockSize > 0 ? { blockSize } : {}),
  };
}

function renderEffectChips(): void {
  effectsHost.replaceChildren(
    ...effects.map((effect) => {
      const text = effectText(effect, locale);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'chip';
      button.dataset.effect = effect.name;
      button.setAttribute('role', 'radio');
      button.setAttribute('aria-checked', String(effect.name === selectedEffect.name));
      button.title = text.description;
      button.textContent = text.name;
      button.classList.toggle('is-active', effect.name === selectedEffect.name);
      button.addEventListener('click', () => {
        selectedEffect = effect;
        defaultsFrom(effect);
        renderEffectChips();
        void rebuildPreview();
      });
      return button;
    }),
  );
}

function applyLocale(): void {
  t = translator(locale);
  applyStaticTranslations(t);
  renderEffectChips();
  localeButton.textContent = locale === 'en' ? '中文' : 'English';
  updateProfileNote();
  if (session) stageSize.textContent = `${session.width} × ${session.height}`;
}

function updateProfileNote(): void {
  const profile = profileSelect.value;
  profileNote.textContent =
    profile === 'oplus' ? t('noteOplus') : profile === 'none' ? t('noteNone') : t('noteGoogle');
}

function stopLoop(): void {
  if (animationFrame !== null) cancelAnimationFrame(animationFrame);
  animationFrame = null;
}

function startLoop(): void {
  stopLoop();
  if (!session) return;
  const context = canvas.getContext('2d');
  if (!context) return;
  const revealMs = session.duration * 1000;
  const cycle = revealMs + HOLD_AFTER_REVEAL_MS;
  const startedAt = performance.now();
  let cycleIndex = 0;

  const tick = (now: number): void => {
    if (!session) return;
    const total = now - startedAt;
    const index = Math.floor(total / cycle);
    if (index !== cycleIndex) {
      // New cycle: block effects accumulate, so the renderer must be rebuilt.
      cycleIndex = index;
      session.reset();
    }
    const elapsed = total - index * cycle;
    const progress = Math.min(1, elapsed / revealMs);
    const frame = session.render(progress);
    context.putImageData(frameToImageData(frame), 0, 0);
    animationFrame = requestAnimationFrame(tick);
  };

  animationFrame = requestAnimationFrame(tick);
}

async function rebuildPreview(): Promise<void> {
  if (!source) return;
  const token = ++rebuildToken;
  stopLoop();
  progressBox.hidden = false;
  progressText.textContent = t('decoding');
  progressFill.style.transform = 'scaleX(0.15)';
  const options = currentOptions();
  try {
    const next = await createPreview({
      source,
      effect: options.effect,
      duration: options.duration,
      fps: options.fps,
      seed: options.seed,
      // The preview decodes small so scrubbing stays responsive; the export
      // re-decodes at the requested size. Passing the export's target size (plus
      // the source's natural size) lets the preview reproduce the export's block
      // count and its blur instead of showing a coarser, blurrier result.
      maxDimension: PREVIEW_MAX_DIMENSION,
      outputMaxDimension: Number(maxDimensionInput.value) || undefined,
      ...(sourceSize ? { sourceSize } : {}),
      ...(options.blockSize ? { blockSize: options.blockSize } : {}),
    });
    if (token !== rebuildToken) return;
    session = next;
    canvas.width = next.width;
    canvas.height = next.height;
    stageSize.textContent = `${next.width} × ${next.height}`;
    startLoop();
  } catch (error) {
    if (token === rebuildToken) {
      progressText.textContent = t('failed', { message: (error as Error).message });
    }
  } finally {
    if (token === rebuildToken) {
      progressBox.hidden = true;
      progressFill.style.transform = 'scaleX(0)';
    }
  }
}

/** Natural pixel size of a source, used to mirror the export's geometry. */
async function measureSource(file: Blob): Promise<{ width: number; height: number } | null> {
  if (typeof createImageBitmap !== 'function') return null;
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return null;
  }
}

async function loadFile(file: File): Promise<void> {
  if (!file.type.startsWith('image/')) return;
  source = file;
  sourceSize = await measureSource(file);
  drop.hidden = true;
  workbench.hidden = false;
  resultBox.hidden = true;
  void rebuildPreview();
}

function humanBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function describeProgress(event: ProgressEvent): void {
  progressBox.hidden = false;
  progressFill.style.transform = `scaleX(${Math.max(0.02, event.progress)})`;
  if (event.stage === 'encode' && event.frame && event.frameCount) {
    const eta = event.etaSeconds ? ` · ${event.etaSeconds}s` : '';
    progressText.textContent = t('encoding', { frame: event.frame, total: event.frameCount }) + eta;
  } else if (event.stage === 'assemble') {
    progressText.textContent = t('assembling');
  } else {
    progressText.textContent = t('decoding');
  }
}

function renderDiagnostics(
  result: Awaited<ReturnType<typeof createMotionPhoto>>,
  checks: ReturnType<typeof inspectMotionPhoto>,
): void {
  const rows: Array<[string, string]> = [
    [t('diagSize'), `${result.width} × ${result.height}`],
    [t('diagFrames'), String(result.frameCount)],
    [t('diagCodec'), result.codec],
    [t('diagBitrate'), `${(result.bitrate / 1_000_000).toFixed(1)} Mbps`],
    [t('diagVideo'), humanBytes(result.videoBytes)],
    [t('diagFile'), humanBytes(result.bytes)],
    [
      t('diagChecks'),
      `${checks.jpeg ? t('yes') : t('no')} · ${checks.motionPhotoMetadata ? t('yes') : t('no')} · ${
        checks.hasMoov ? t('yes') : t('no')
      }`,
    ],
  ];
  diagnostics.replaceChildren(
    ...rows.flatMap(([label, value]) => {
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.textContent = value;
      return [dt, dd];
    }),
  );
}

async function runExport(): Promise<void> {
  if (!source || !canExport) return;
  exportButton.disabled = true;
  resultBox.hidden = true;
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }
  const startedAt = performance.now();
  try {
    const result = await createMotionPhoto({
      source,
      ...currentOptions(),
      onProgress: describeProgress,
    });
    const bytes = new Uint8Array(await result.blob.arrayBuffer());
    const checks = inspectMotionPhoto(bytes);
    objectUrl = URL.createObjectURL(result.blob);
    downloadLink.href = objectUrl;
    downloadLink.download = `pixel-reveal-${selectedEffect.name}-${result.width}x${result.height}.jpg`;
    renderDiagnostics(result, checks);
    resultBox.hidden = false;
    progressText.textContent = t('done', {
      seconds: ((performance.now() - startedAt) / 1000).toFixed(1),
    });
  } catch (error) {
    progressText.textContent = t('failed', { message: (error as Error).message });
  } finally {
    exportButton.disabled = false;
    progressBox.hidden = true;
    progressFill.style.transform = 'scaleX(0)';
  }
}

// ---------------------------------------------------------------- wiring

drop.addEventListener('click', () => fileInput.click());
drop.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    fileInput.click();
  }
});
fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (file) loadFile(file);
});
for (const type of ['dragenter', 'dragover']) {
  drop.addEventListener(type, (event) => {
    event.preventDefault();
    drop.classList.add('is-over');
  });
}
for (const type of ['dragleave', 'drop']) {
  drop.addEventListener(type, (event) => {
    event.preventDefault();
    drop.classList.remove('is-over');
  });
}
drop.addEventListener('drop', (event) => {
  const file = event.dataTransfer?.files?.[0];
  if (file) loadFile(file);
});
$('change').addEventListener('click', () => fileInput.click());

localeButton.addEventListener('click', () => {
  locale = locale === 'en' ? 'zh' : 'en';
  rememberLocale(locale);
  applyLocale();
});

shuffleButton.addEventListener('click', () => {
  seedInput.value = String(1 + Math.floor(Math.random() * 999_998));
  void rebuildPreview();
});

for (const input of [durationInput, fpsInput, blockSizeInput, maxDimensionInput, seedInput]) {
  input.addEventListener('change', () => void rebuildPreview());
}
coverSelect.addEventListener('change', () => void rebuildPreview());
profileSelect.addEventListener('change', () => {
  updateProfileNote();
});
appNameInput.addEventListener('change', () => void rebuildPreview());
exportButton.addEventListener('click', () => void runExport());

if (!canExport) {
  exportButton.disabled = true;
  exportButton.title = t('unsupported');
  progressBox.hidden = false;
  progressText.textContent = t('unsupported');
}

defaultsFrom(selectedEffect);
rememberLocale(locale);
applyLocale();
updateProfileNote();
