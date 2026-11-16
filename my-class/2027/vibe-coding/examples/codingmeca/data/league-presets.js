// data/league-presets.js
// 리그 프리셋 (명세 18-3): 리그를 만들 때 한 번에 채워 주는 기본 설정 묶음. 조율 센터에서 수치를 고칠 수 있다.
// 입문: 가벼운 기체로 규칙을 익히는 수업용 / 표준: 기본 한도 / 무제한: 한도를 사실상 풀고 마음껏 실험.

export const LEAGUE_PRESETS = Object.freeze([
  Object.freeze({ id: 'beginner', name: '입문', desc: '작고 가벼운 기체로 규칙을 익히는 첫 수업용', teamSize: 1, weightCap: 60, budget: 600, matchSeconds: 120 }),
  Object.freeze({ id: 'standard', name: '표준', desc: '기본 한도. 대부분의 수업·리그에 알맞음', teamSize: 1, weightCap: 100, budget: 1000, matchSeconds: 180 }),
  Object.freeze({ id: 'unlimited', name: '무제한', desc: '한도를 사실상 풀고 마음껏 실험', teamSize: 1, weightCap: 999, budget: 99999, matchSeconds: 300 }),
]);
