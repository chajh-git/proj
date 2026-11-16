// web/editor/control-factory.js
// 변수 명세(config/balance-schema.js) 하나로 알맞은 편집 컴포넌트를 만들어 준다. (명세 18-2)
//   buildControl(spec, { value, onChange }) → { el, set(v) }
//   · 슬라이더·숫자 입력은 항상 함께 나오고, 형식에 따라 퍼센트·스테퍼·세그먼트·칩·이중 핸들·곡선·3칸 스테퍼가 선택된다.

import { el } from '../ui/dom.js';
import { createSliderNumber, createSecondsInput } from './components/slider-number.js';
import { createPercentSlider } from './components/percent-slider.js';
import { createRangeSlider } from './components/range-slider.js';
import { createChipSelect } from './components/chip-select.js';
import { createSegmented, createToggle } from './components/segmented.js';
import { createStepper3 } from './components/stepper3.js';
import { createCurveEditor } from './components/curve-editor.js';

export function buildControl(spec, { value, onChange }) {
  switch (spec.type) {
    case 'int': return createSliderNumber({ value, min: spec.min, max: spec.max, step: spec.step ?? 1, unit: spec.unit || '', int: true, onChange });
    case 'num': return createSliderNumber({ value, min: spec.min, max: spec.max, step: spec.step ?? 0.01, unit: spec.unit || '', onChange });
    case 'ratio': return createPercentSlider({ value, min: spec.min, max: spec.max, step: spec.step ?? 0.01, onChange });
    case 'seconds': return createSecondsInput({ value, min: spec.min, max: spec.max, step: spec.step ?? 1, unit: spec.unit || '초', onChange });
    case 'bool': return createToggle({ value, onChange });
    case 'enum': return createSegmented({ options: spec.options, value, onChange });
    case 'multi': return createChipSelect({ options: spec.options, value, onChange });
    case 'range': return createRangeSlider({ value, min: spec.min, max: spec.max, step: spec.step ?? 0.01, unit: spec.unit || '', scale: spec.scale || 1, onChange });
    case 'curve': return createCurveEditor({ points: value, xMin: spec.xMin, xMax: spec.xMax, yMin: spec.yMin, yMax: spec.yMax, xLabel: spec.xLabel, yLabel: spec.yLabel, lockX: spec.lockX, onChange });
    case 'triple': return createStepper3({ value, min: spec.min ?? 0, max: spec.max ?? 9, onChange });
    case 'record': {
      const cur = { ...value };
      const parts = {};
      const rows = spec.keys.map(([k, label]) => {
        const sub = spec.item === 'ratio'
          ? createPercentSlider({ value: cur[k], min: spec.min, max: spec.max, step: spec.step ?? 0.01, onChange: (v) => { cur[k] = v; onChange({ ...cur }); } })
          : createSliderNumber({ value: cur[k], min: spec.min, max: spec.max, step: spec.step ?? 1, int: spec.item === 'int', onChange: (v) => { cur[k] = v; onChange({ ...cur }); } });
        parts[k] = sub;
        return el('div', { class: 'ed-rec' }, el('b', {}, label), sub.el);
      });
      return {
        el: el('div', { class: 'ed-recs' }, rows),
        set(v) { for (const [k] of spec.keys) { cur[k] = v[k]; parts[k].set(v[k]); } },
        get: () => ({ ...cur }),
      };
    }
    default: return { el: el('span', {}, `(지원하지 않는 형식: ${spec.type})`), set() {}, get: () => value };
  }
}
