// config/env.js
// 접속 주소 모음. 공개 저장소에 올라가도 되는 값만 적습니다.
//  - Supabase 'anon(공개) 키'는 원래 브라우저에 노출되는 키입니다(권한은 DB의 행 수준 보안 정책이 지킵니다).
//  - 절대로 service_role 키나 서버 비밀값을 여기에 적지 마세요. (그건 비공개 서버 저장소의 환경변수에만)
// 배포 후 아래 빈칸 세 곳만 채우면 됩니다.

export const ENV = Object.freeze({
  supabaseUrl: 'https://lxtvsxqdfcqqoihfgtxa.supabase.co', // 예: 'https://abcdxyz.supabase.co'
  supabaseAnonKey: 'sb_publishable_97nYK-bgPlL5JFD6ILIzbA_sK9-K0Kj', // Supabase 프로젝트 설정 → API → anon public
  serverUrl: 'wss://codingmeca-server.onrender.com', // 예: 'wss://codingmeca-server.onrender.com'
  supabaseEsm: 'https://esm.sh/@supabase/supabase-js@2.45.4', // Supabase 클라이언트 라이브러리 위치
});

// 비어 있으면 '오프라인 모드'로 동작합니다(로그인·서버 대전 없이 격납고·신경 연산실만 사용).
export const isOnlineConfigured = (env = ENV) => Boolean(env.supabaseUrl && env.supabaseAnonKey);
export const isServerConfigured = (env = ENV) => Boolean(env.serverUrl);
