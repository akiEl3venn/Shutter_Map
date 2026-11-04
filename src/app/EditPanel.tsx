import { useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { LayerId, MapComposition, PhotoSession } from '../contracts.ts';
import { MAX_RANGE_KM, MIN_LAYER_PX, MIN_RANGE_KM, type Anchor, type EditAction, type EditorState } from '../map/editComposition.ts';
import { circleFeather, sideFeather } from '../map/style.ts';
import type { DragMode } from './PhotoCanvas.tsx';
import { scrubbedValue } from './scrub.ts';
import { strings as s } from './strings.ts';

type Edit = (action: EditAction) => void;
type FourSides = [number, number, number, number];
const directions = ['↖', '↑', '↗', '←', '●', '→', '↙', '↓', '↘'];
const levels = [-1, 0, 1, 2] as const;
const layerNames: Record<LayerId, string> = {
  roads: s.layerRoads, hiking: s.layerHiking, water: s.layerWater, places: s.layerPlaces,
};
const format = (n: number) => String(Number(n.toFixed(2)));

function Group({ title, first, children }: { title: string; first?: boolean; children: ReactNode }) {
  return <details open={first}><summary>{title}</summary><div className="edit-group">{children}</div></details>;
}

function Radios<T extends string | number>({ title, value, options, change }: {
  title: string; value: T; options: readonly (readonly [T, string])[]; change: (choice: T) => void;
}) {
  const group = useId();
  return <fieldset className="edit-options"><legend>{title}</legend>
    {options.map(([choice, label]) => <label key={choice}><input type="radio" name={group} value={choice}
      checked={choice === value} onChange={() => change(choice)} />{label}</label>)}
  </fieldset>;
}

interface NumericProps {
  label: string; value: number; min: number; max: number; step?: number; unit?: string; disabled?: boolean; log?: boolean;
  change: (value: number) => void;
}

/** Keep an incomplete typed value until commit, while idle fields always reflect the reducer. */
function NumberField({ label, value, min, max, step = 1, unit, disabled, log, change }: NumericProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const drag = useRef<{ id: number; x: number; start: number; moved: boolean } | null>(null);
  return <label className="edit-number"><span>{label}</span><span className="edit-number-box">
    <input type="number" aria-label={label} min={min} max={max} step={step} disabled={disabled}
      // Dragging adjusts the value; a click without movement still opens it for typing.
      onMouseDown={e => { if (document.activeElement !== e.currentTarget) e.preventDefault(); }}
      onPointerDown={e => {
        if (e.button !== 0 || document.activeElement === e.currentTarget) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { id: e.pointerId, x: e.clientX, start: value, moved: false };
      }}
      onPointerMove={e => {
        const d = drag.current;
        if (!d || d.id !== e.pointerId) return;
        const dx = e.clientX - d.x;
        if (!d.moved && Math.abs(dx) < 3) return;
        d.moved = true;
        change(scrubbedValue(d.start, dx, { min, max, step, log }));
      }}
      onPointerUp={e => {
        const d = drag.current;
        drag.current = null;
        if (d && !d.moved) { e.currentTarget.focus(); e.currentTarget.select(); }
      }}
      onLostPointerCapture={() => { drag.current = null; }}
      value={draft ?? format(value)} onChange={e => {
        // Typing reports an input type. The arrows and spinner do not, and should apply at once.
        if ((e.nativeEvent as InputEvent).inputType || !Number.isFinite(e.currentTarget.valueAsNumber)) setDraft(e.currentTarget.value);
        else { setDraft(null); change(e.currentTarget.valueAsNumber); }
      }}
      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
      onBlur={e => {
        if (draft !== null && Number.isFinite(e.currentTarget.valueAsNumber)) change(e.currentTarget.valueAsNumber);
        setDraft(null);
      }} />
    {unit && <small aria-hidden="true">{unit}</small>}
  </span></label>;
}

function Range({ label, value, min, max, step = 1, display, change, compact }: {
  label: string; value: number; min: number; max: number; step?: number; display: string;
  change: (value: number) => void; compact?: boolean;
}) {
  return <label className="edit-range">
    <span className={compact ? 'sr-only' : 'edit-range-name'}>{label} <span>{display}</span></span>
    <input type="range" aria-label={label} aria-valuetext={display} min={min} max={max} step={step}
      value={value} onChange={e => change(e.currentTarget.valueAsNumber)} />
  </label>;
}

function Placement({ state, photo, edit, mode, setMode }: EditPanelProps) {
  const c = state.composition;
  const long = Math.max(photo.orientedWidthPx, photo.orientedHeightPx);
  const shortLimit = Math.min(MIN_LAYER_PX, long);
  // The size slider scales both axes. Its legal width also depends on the rectangle's height.
  const minWidth = shortLimit * c.widthPx / Math.min(c.widthPx, c.heightPx);
  const maxWidth = long * c.widthPx / Math.max(c.widthPx, c.heightPx);
  const km = c.widthPx * c.metersPerImagePixel / 1000;
  const kmRatio = MAX_RANGE_KM / MIN_RANGE_KM;
  const setSize = (value: number) => edit({ type: 'size', value });
  const setRange = (value: number) => edit({ type: 'range', value });
  const setRotation = (value: number) => edit({ type: 'rotation', value });
  return <Group title={s.editPlacement} first>
    <Radios<DragMode> title={s.dragMode} value={mode}
      options={[[ 'layer', s.dragLayer ], [ 'map', s.dragMap ]]} change={setMode} />
    <fieldset className="edit-anchors"><legend>{s.anchorGrid}</legend><div>
      {s.anchors.map((name, index) => {
        const anchor: Anchor = [index % 3 as Anchor[0], Math.floor(index / 3) as Anchor[1]];
        return <button type="button" key={name} title={name} aria-label={name}
          aria-pressed={state.anchor?.[0] === anchor[0] && state.anchor[1] === anchor[1]}
          onClick={() => edit({ type: 'anchor', value: anchor })}>{directions[index]}</button>;
      })}
    </div></fieldset>
    <div className="edit-columns">
      <NumberField label={s.marginX} value={state.marginPx[0]} min={0} max={photo.orientedWidthPx} unit="px"
        disabled={!state.anchor} change={x => edit({ type: 'margin', value: [x, state.marginPx[1]] })} />
      <NumberField label={s.marginY} value={state.marginPx[1]} min={0} max={photo.orientedHeightPx} unit="px"
        disabled={!state.anchor} change={y => edit({ type: 'margin', value: [state.marginPx[0], y] })} />
      {!state.anchor && <p className="muted edit-note">{s.marginHint}</p>}
      <NumberField label={s.centerX} value={c.centerPx[0]} min={0} max={photo.orientedWidthPx} unit="px"
        change={x => edit({ type: 'center', value: [x, c.centerPx[1]] })} />
      <NumberField label={s.centerY} value={c.centerPx[1]} min={0} max={photo.orientedHeightPx} unit="px"
        change={y => edit({ type: 'center', value: [c.centerPx[0], y] })} />
    </div>
    <div className="edit-range-pair">
      <NumberField label={s.layerSize} unit="px" value={c.widthPx} min={minWidth} max={maxWidth} change={setSize} />
      <Range compact label={s.layerSize} min={minWidth} max={maxWidth} value={c.widthPx}
        display={format(c.widthPx) + ' px'} change={setSize} />
    </div>
    {c.shape === 'rectangle' && <div className="edit-columns">
      <NumberField label={s.layerWidth} value={c.widthPx} min={shortLimit} max={long} unit="px"
        change={value => edit({ type: 'width', value })} />
      <NumberField label={s.layerHeight} value={c.heightPx} min={shortLimit} max={long} unit="px"
        change={value => edit({ type: 'height', value })} />
    </div>}
    <div className="edit-range-pair">
      <NumberField label={s.geoRange} value={km} min={MIN_RANGE_KM} max={MAX_RANGE_KM} step={0.01} log unit="km" change={setRange} />
      <Range compact label={s.geoRange} min={0} max={1} step={0.001} value={Math.log(km / MIN_RANGE_KM) / Math.log(kmRatio)}
        display={km.toFixed(2) + ' km'} change={t => setRange(MIN_RANGE_KM * kmRatio ** t)} />
    </div>
    <div className="edit-range-pair">
      <NumberField label={s.rotation} value={c.rotationDegrees} min={-180} max={180} unit="°" change={setRotation} />
      <Range compact label={s.rotation} min={-180} max={180} value={c.rotationDegrees}
        display={format(c.rotationDegrees) + '°'} change={setRotation} />
      <button type="button" className="secondary edit-zero" onClick={() => setRotation(0)}>{s.rotationReset}</button>
    </div>
  </Group>;
}

const featherNames = [s.featherTop, s.featherRight, s.featherBottom, s.featherLeft];
function FeatherSlider({ label, percent, change }: { label: string; percent: number; change: (n: number) => void }) {
  return <Range label={label} min={0} max={100} value={percent} change={change}
    display={percent === 0 ? s.featherHard : Math.max(1, Math.round(percent)) + '%'} />;
}

function Shape({ c, edit }: { c: MapComposition; edit: Edit }) {
  const [linked, setLinked] = useState({ square: true, rectangle: true });
  const half: FourSides = [c.heightPx / 2, c.widthPx / 2, c.heightPx / 2, c.widthPx / 2];
  const sides = sideFeather(c);
  const percent = sides.map((value, i) => value / half[i] * 100);
  const saved = c.shape === 'square' ? c.feather.squarePx : c.feather.rectanglePx;
  // Together, all four edges fade over the same width, measured against the short side.
  const shortHalf = Math.min(half[0], half[1]);
  const together = c.shape !== 'circle' && linked[c.shape] && saved.every(value => Math.abs(value - saved[0]) < 1e-6);
  const percentTogether = Math.min(saved[0], shortHalf) / shortHalf * 100;
  const changeTogether = (n: number) => edit({ type: 'allFeather', value: shortHalf * n / 100 });
  return <Group title={s.editShape}>
    <Radios<MapComposition['shape']> title={s.shape} value={c.shape} change={value => edit({ type: 'shape', value })}
      options={[[ 'circle', s.shapeCircle ], [ 'square', s.shapeSquare ], [ 'rectangle', s.shapeRectangle ]]} />
    {c.shape === 'circle' ? <FeatherSlider label={s.feather} percent={circleFeather(c) / half[1] * 100}
      change={n => edit({ type: 'circleFeather', value: n * half[1] / 100 })} /> : <>
      <label className="edit-check"><input type="checkbox" checked={together} onChange={e => {
        const together = e.currentTarget.checked;
        setLinked({ ...linked, [c.shape]: together });
        if (together) changeTogether(percentTogether);
      }} />{s.featherLinked}</label>
      {together ? <FeatherSlider label={s.feather} percent={percentTogether} change={changeTogether} />
        : featherNames.map((name, i) => <FeatherSlider key={name} label={name} percent={percent[i]}
          change={n => edit({ type: 'sideFeather', side: i as 0 | 1 | 2 | 3, value: half[i] * n / 100 })} />)}
      {together && c.feather.hardSides.some(Boolean) && <p className="muted">{s.featherCornerNote}</p>}
    </>}
  </Group>;
}

interface EditPanelProps {
  state: EditorState; photo: PhotoSession; edit: Edit;
  mode: DragMode; setMode: (mode: DragMode) => void;
}
export function EditPanel(props: EditPanelProps) {
  const { state: { composition: c }, edit } = props;
  const [lastColor, setLastColor] = useState<`#${string}`>('#ffffff');
  return <section className="edit-panel" id="edit-panel">
    <Placement {...props} />
    <Shape c={c} edit={edit} />
    <Group title={s.editStyle}>
      <Radios<'auto' | 'custom'> title={s.lineColor} value={c.style.color === 'auto' ? 'auto' : 'custom'}
        options={[[ 'auto', s.colorAuto ], [ 'custom', s.colorCustom ]]}
        change={value => edit({ type: 'color', value: value === 'auto' ? 'auto' : lastColor })} />
      {c.style.color !== 'auto' && <label className="edit-color">{s.lineColor}
        <input type="color" value={c.style.color} onChange={e => {
          const value = e.currentTarget.value as `#${string}`;
          setLastColor(value);
          edit({ type: 'color', value });
        }} /><span>{c.style.color.toUpperCase()}</span>
      </label>}
      <Range label={s.lineWidth} min={50} max={200} value={c.style.lineScale * 100}
        display={format(c.style.lineScale * 100) + '%'} change={n => edit({ type: 'lineScale', value: n / 100 })} />
      <Range label={s.opacity} min={10} max={100} value={c.style.opacity * 100}
        display={format(c.style.opacity * 100) + '%'} change={n => edit({ type: 'opacity', value: n / 100 })} />
    </Group>
    <Group title={s.editLayers}>
      <div className="edit-columns">{(Object.keys(layerNames) as LayerId[]).map(layer => <label className="edit-check" key={layer}>
        <input type="checkbox" checked={c.visibleLayers[layer]}
          onChange={e => edit({ type: 'layer', layer, value: e.currentTarget.checked })} />{layerNames[layer]}
      </label>)}</div>
      <Radios title={s.detail} value={c.detailOffset} options={levels.map((level, i) => [level, s.detailLevels[i]])}
        change={value => edit({ type: 'detail', value })} />
      <p className="muted">{s.detailNote}</p>
    </Group>
    <Group title={s.editLabels}>
      <fieldset className="edit-labels" disabled={!c.visibleLayers.places}>
        <label>{s.labelLanguage}<select value={c.labels.language}
          onChange={e => edit({ type: 'language', value: e.currentTarget.value as MapComposition['labels']['language'] })}>
          <option value="local">{s.labelLocal}</option><option value="en">English</option>
          <option value="zh">中文</option><option value="ja">日本語</option>
        </select></label>
        <NumberField label={s.labelCount} min={0} max={20} step={1} value={c.labels.maxCount}
          change={value => edit({ type: 'maxCount', value })} />
        <label className="edit-check"><input type="checkbox" checked={c.labels.showAreas}
          onChange={e => edit({ type: 'showAreas', value: e.currentTarget.checked })} />{s.labelAreas}</label>
      </fieldset>
    </Group>
    <button type="button" className="secondary" onClick={() => edit({ type: 'reset' })}>{s.resetComposition}</button>
  </section>;
}
