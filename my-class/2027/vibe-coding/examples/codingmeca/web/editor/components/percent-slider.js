// web/editor/components/percent-slider.js  (107번)
// 비율·배율용 슬라이더. 저장 값은 0.2 같은 비율이고, 화면에는 20 % 로 보여 준다. (슬라이더 + 숫자 입력)
//   createPercentSlider({ value, min, max, step, onChange }) → { el, get, set }

import { createSliderNumber } from './slider-number.js';

export function createPercentSlider({ value, min = 0, max = 1, step = 0.01, onChange = () => {} } = {}) {
  return createSliderNumber({ value, min, max, step, unit: '%', scale: 100, onChange });
}
