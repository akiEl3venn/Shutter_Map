import { NumberField, Radios, Range } from './EditPanel.tsx';
import { brushMaxSize, maxFeather, type MaskAction, type MaskState } from './maskEditor.ts';
import { strings as s } from './strings.ts';

export function MaskToolbar({ state, edit }: { state: MaskState; edit: (action: MaskAction) => void }) {
  const { tools, penDraft } = state;
  const sizeLimit = brushMaxSize(state.photo);
  const feather = tools.featherPx[tools.tool];
  const featherLimit = maxFeather(state);
  const size = (value: number) => edit({ type: 'size', value });
  const fade = (value: number) => edit({ type: 'feather', value });
  return <div className="mask-toolbar" role="group" aria-label={s.maskTitle}>
    <Radios title={s.maskTool} value={tools.tool}
      options={[[ 'pen', s.maskPen ], [ 'lasso', s.maskLasso ], [ 'brush', s.maskBrush ]]}
      change={value => edit({ type: 'tool', value })} />
    <Radios title={s.maskMode} value={tools.mode} options={[[ 'add', s.maskAdd ], [ 'erase', s.maskErase ]]}
      change={value => edit({ type: 'mode', value })} />
    {tools.tool === 'brush' && <div className="mask-slider">
      <NumberField label={s.maskSize} value={tools.sizePx} min={1} max={sizeLimit} log unit="px" change={size} />
      <Range compact label={s.maskSize} min={0} max={1} step={0.001}
        value={sizeLimit > 1 ? Math.log(tools.sizePx) / Math.log(sizeLimit) : 0}
        display={tools.sizePx + ' px'} change={t => size(Math.round(sizeLimit ** t))} />
    </div>}
    <div className="mask-slider">
      <NumberField label={s.maskFeather} value={feather} min={0} max={featherLimit}
        unit={feather ? 'px' : s.featherHard} change={fade} />
      <Range compact label={s.maskFeather} min={0} max={featherLimit} value={feather}
        display={feather ? feather + ' px' : s.featherHard} change={fade} />
    </div>
    <label className="edit-check"><input type="checkbox" checked={tools.show}
      onChange={e => edit({ type: 'show', value: e.currentTarget.checked })} />{s.maskShow}</label>
    <div className="mask-actions">
      <button type="button" className="secondary" disabled={!penDraft.length && !state.past.length}
        onClick={() => edit({ type: penDraft.length ? 'undoPoint' : 'undo' })}>{s.maskUndo}</button>
      <button type="button" className="secondary" disabled={!state.future.length}
        onClick={() => edit({ type: 'redo' })}>{s.maskRedo}</button>
      <button type="button" onClick={() => edit({ type: 'finish' })}>{s.maskDone}</button>
    </div>
    <p className="mask-hint muted">{s.maskHints[tools.tool]}</p>
  </div>;
}
