// web/editor/panels/pilot-panel.js  (120번) — 조종사 각성기 수치. (명세 18-3)
import { PILOT_SKILLS } from '../../../data/pilot-skills.js';
import { createItemPanel } from './item-panel.js';
export function createPilotPanel({ store, kit }) {
  return createItemPanel({ store, kit, section: 'skills', id: 'pilot', label: '조종사 각성기', items: Object.values(PILOT_SKILLS), itemLabel: (s) => s.label || s.id });
}
