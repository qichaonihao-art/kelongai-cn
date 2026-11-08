import { useId, type CSSProperties, type ReactNode } from 'react';

type DecorProps = {
  className?: string;
  style?: CSSProperties;
};

/* ------------------------------------------------------------------ */
/* 灯笼                                                                */
/* ------------------------------------------------------------------ */

const ROUND_BODY_PATH =
  "M100 94C52 96 28 124 28 166c0 48 28 76 72 80 44-4 72-32 72-80 0-42-24-70-72-72Z";

export function SpringLantern({
  className,
  style,
  delay = 0,
}: DecorProps & { delay?: number }) {
  const uid = useId().replace(/:/g, '');
  const bodyId = `${uid}-silk`;
  const edgeId = `${uid}-edge`;
  const innerId = `${uid}-inner`;
  const outerId = `${uid}-outer`;
  const goldId = `${uid}-gold`;
  const goldVId = `${uid}-gold-v`;
  const bronzeId = `${uid}-bronze`;
  const fringeId = `${uid}-fringe`;
  const fringeWashId = `${uid}-fringe-wash`;
  const tasselId = `${uid}-tassel`;
  const softId = `${uid}-soft`;
  const softBId = `${uid}-soft-b`;
  const clipId = `${uid}-clip`;

  const fringe = Array.from({ length: 42 }, (_, index) => {
    const t = index / 41;
    const xTop = 66 + t * 68;
    const xBottom = 60 + t * 80;
    const yBottom = 284 - Math.abs(t - 0.5) * 5 + (index % 2);
    return `M${xTop.toFixed(1)} 250L${xBottom.toFixed(1)} ${yBottom.toFixed(1)}`;
  }).join(' ');

  return (
    <div
      className={`spring-lantern${className ? ` ${className}` : ''}`}
      style={{ ...style, '--lantern-delay': `${delay}s` } as CSSProperties}
      aria-hidden="true"
    >
      <span className="spring-lantern-glow" />
      <svg viewBox="0 0 200 400" fill="none" className="spring-lantern-svg">
        <defs>
          <radialGradient id={bodyId} cx="46%" cy="48%" r="68%">
            <stop offset="0%" stopColor="#FFE0A2" />
            <stop offset="10%" stopColor="#FFB062" />
            <stop offset="26%" stopColor="#EF6A3E" />
            <stop offset="48%" stopColor="#D23A28" />
            <stop offset="72%" stopColor="#A72419" />
            <stop offset="100%" stopColor="#5E0D0A" />
          </radialGradient>
          <linearGradient id={edgeId} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#2E0403" stopOpacity=".5" />
            <stop offset="12%" stopColor="#2E0403" stopOpacity="0" />
            <stop offset="55%" stopColor="#2E0403" stopOpacity="0" />
            <stop offset="88%" stopColor="#2E0403" stopOpacity=".28" />
            <stop offset="100%" stopColor="#2E0403" stopOpacity=".6" />
          </linearGradient>
          <radialGradient id={innerId} cx="48%" cy="52%" r="46%">
            <stop offset="0%" stopColor="#FFE9B0" stopOpacity=".55" />
            <stop offset="40%" stopColor="#FFB468" stopOpacity=".18" />
            <stop offset="100%" stopColor="#FFB468" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={outerId} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#FFB45E" stopOpacity=".3" />
            <stop offset="55%" stopColor="#F07A3C" stopOpacity=".1" />
            <stop offset="100%" stopColor="#F07A3C" stopOpacity="0" />
          </radialGradient>
          <linearGradient id={goldId} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#5E3A12" />
            <stop offset="12%" stopColor="#B5812F" />
            <stop offset="32%" stopColor="#F7E3B4" />
            <stop offset="50%" stopColor="#E2BC72" />
            <stop offset="70%" stopColor="#C99A45" />
            <stop offset="88%" stopColor="#8A5A23" />
            <stop offset="100%" stopColor="#563510" />
          </linearGradient>
          <linearGradient id={goldVId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#563510" />
            <stop offset="18%" stopColor="#B5812F" />
            <stop offset="42%" stopColor="#F3D9A4" />
            <stop offset="68%" stopColor="#C99A45" />
            <stop offset="100%" stopColor="#6E4618" />
          </linearGradient>
          <linearGradient id={bronzeId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1B0E09" />
            <stop offset="45%" stopColor="#3D2418" />
            <stop offset="100%" stopColor="#160B07" />
          </linearGradient>
          <linearGradient id={fringeId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#F7E3B4" />
            <stop offset="35%" stopColor="#D9AE5F" />
            <stop offset="100%" stopColor="#8A5A23" />
          </linearGradient>
          <linearGradient id={fringeWashId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#E8C77E" stopOpacity=".3" />
            <stop offset="65%" stopColor="#C99A45" stopOpacity=".08" />
            <stop offset="100%" stopColor="#8A5A23" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={tasselId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#E06045" />
            <stop offset="45%" stopColor="#B83226" />
            <stop offset="100%" stopColor="#6E130E" />
          </linearGradient>
          <filter id={softId} x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="10" />
          </filter>
          <filter id={softBId} x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="5" />
          </filter>
          <clipPath id={clipId}>
            <path d={ROUND_BODY_PATH} />
          </clipPath>
        </defs>

        <ellipse cx="100" cy="170" rx="96" ry="90" fill={`url(#${outerId})`} filter={`url(#${softId})`} />

        {/* 提绳与吊环 */}
        <path d="M100 2v30" stroke="#D9AE5F" strokeWidth="1.2" />
        <path d="M99 2v30" stroke="#FFF0C8" strokeWidth=".35" opacity=".6" />
        <circle cx="100" cy="38" r="6.2" fill="none" stroke={`url(#${goldId})`} strokeWidth="1.9" />
        <circle cx="100" cy="38" r="1.9" fill="#F3D9A4" />
        <circle cx="100" cy="52" r="5.2" fill="#B83226" stroke="#D9AE5F" strokeWidth=".8" />

        {/* 金顶：黑漆铜胎 + 鎏金镂空 */}
        <path
          d="M72 64Q100 54 128 64l-2 12Q100 68 74 76l-2-12Z"
          fill={`url(#${bronzeId})`}
          stroke="#D9AE5F"
          strokeWidth=".7"
        />
        <path d="M73 65Q100 57 127 65" stroke="#F3D9A4" strokeWidth=".8" opacity=".7" />
        <path d="M74 76Q100 68 126 76l-1 10Q100 78 75 86l-1-10Z" fill={`url(#${goldId})`} />
        <g fill="#3A2418" opacity=".8">
          <circle cx="80" cy="80" r="1.1" />
          <circle cx="88" cy="78" r="1.1" />
          <circle cx="96" cy="77" r="1.1" />
          <circle cx="104" cy="77" r="1.1" />
          <circle cx="112" cy="78" r="1.1" />
          <circle cx="120" cy="80" r="1.1" />
        </g>
        <path
          d="M75 86Q100 78 125 86l-1 8Q100 86 76 94l-1-8Z"
          fill={`url(#${bronzeId})`}
          stroke="#D9AE5F"
          strokeWidth=".5"
        />

        {/* 绸面灯身 */}
        <path d={ROUND_BODY_PATH} fill={`url(#${bodyId})`} />
        <path d={ROUND_BODY_PATH} fill={`url(#${edgeId})`} />
        <g clipPath={`url(#${clipId})`}>
          <ellipse cx="98" cy="172" rx="58" ry="64" fill={`url(#${innerId})`} filter={`url(#${softBId})`} />
          <path
            d="M52 102Q100 110 148 102v22Q100 132 52 122v-20Z"
            fill="#3A0604"
            opacity=".22"
            filter={`url(#${softBId})`}
          />
          <g stroke="#4A0A08" strokeWidth="1.35" opacity=".55">
            <path d="M100 96v148" />
            <path d="M68 98c-9 24-14 44-14 68 0 30 6 56 14 78" />
            <path d="M132 98c9 24 14 44 14 68 0 30-6 56-14 78" />
            <path d="M50 104c-11 24-17 44-17 64 0 28 7 54 16 76" />
            <path d="M150 104c11 24 17 44 17 64 0 28-7 54-16 76" />
            <path d="M36 118c-6 20-10 36-10 52 0 24 5 46 11 66" />
            <path d="M164 118c6 20 10 36 10 52 0 24-5 46-11 66" />
            <path d="M84 96c-7 24-10 44-10 70 0 30 4 56 10 78" />
            <path d="M116 96c7 24 10 44 10 70 0 30-4 56-10 78" />
          </g>
          <g stroke="#FFB070" strokeWidth=".65" opacity=".12">
            <path d="M66 100c-9 24-14 44-14 68 0 29 5 55 13 77" />
            <path d="M48 106c-11 24-17 44-17 64 0 27 6 53 15 75" />
            <path d="M82 98c-7 24-10 44-10 70 0 29 4 55 9 77" />
          </g>
          <path d="M100 96v148" stroke="#3D0806" strokeWidth="2.2" opacity=".55" />
          <ellipse cx="62" cy="150" rx="12" ry="46" fill="#FFD0A8" opacity=".09" filter={`url(#${softBId})`} />
          <ellipse cx="150" cy="186" rx="14" ry="42" fill="#3A0604" opacity=".16" filter={`url(#${softBId})`} />
        </g>

        {/* 上口金箍 */}
        <path d="M74 94c9 5 43 5 52 0l-1 10c-9 5-41 5-50 0l-1-10Z" fill={`url(#${goldId})`} />
        <path d="M76 96c9 4 39 4 48 0" stroke="#FFF0C8" strokeWidth=".7" opacity=".6" />

        {/* 下口金箍 */}
        <path d="M74 240c9-5 43-5 52 0l-1 10c-9 5-41 5-50 0l-1-10Z" fill={`url(#${goldId})`} />
        <path d="M76 242c9-4 39-4 48 0" stroke="#FFF0C8" strokeWidth=".7" opacity=".6" />
        <path d="M75 247c9-4 41-4 50 0" stroke="#6E4618" strokeWidth=".6" opacity=".5" />

        {/* 金流苏裙 */}
        <path d="M66 250h68l6 34H60l6-34Z" fill={`url(#${fringeWashId})`} />
        <path d={fringe} stroke={`url(#${fringeId})`} strokeWidth=".8" opacity=".9" />
        <path d="M60 284h80l-1 4H61l-1-4Z" fill="#8A5A23" opacity=".22" />

        {/* 灯坠与红流苏 */}
        <path d="M93 292h14l-2 9h-10l-2-9Z" fill={`url(#${bronzeId})`} stroke="#D9AE5F" strokeWidth=".6" />
        <circle cx="100" cy="306" r="6" fill={`url(#${tasselId})`} stroke="#D9AE5F" strokeWidth=".8" />
        <path
          d="M91 314c4-4 14-4 18 0l-2 10c-4 4-10 4-14 0l-2-10Z"
          fill={`url(#${tasselId})`}
          stroke="#D9AE5F"
          strokeWidth=".5"
        />
        <rect x="91" y="314" width="18" height="3" rx="1.5" fill={`url(#${goldId})`} />
        <g className="spring-lantern-tassel" strokeLinecap="round">
          <path
            d="M68 326C60 346 52 366 47 383c15 6 34 9 53 9s38-3 53-9c-5-17-13-37-21-57Z"
            fill={`url(#${tasselId})`}
            opacity=".16"
            filter={`url(#${softBId})`}
          />
          <g stroke={`url(#${tasselId})`} strokeWidth="2">
            <path d="M92 324c-8 17-16 35-24 54" />
            <path d="M93.5 324c-7 18-14 36-22 55" />
            <path d="M95 324c-6 19-11 39-17 58" />
            <path d="M96 324c-5 19-10 40-15 59" />
            <path d="M97 324c-3 21-5 42-8 62" />
            <path d="M98 324c-2 21-4 43-6 63" />
            <path d="M99 324c-1 22-2 43-3 64" />
            <path d="M100 324c0 22 0 44 1 65" />
            <path d="M101 324c1 22 2 43 4 64" />
            <path d="M102 324c2 21 4 43 7 63" />
            <path d="M103 324c3 21 6 42 10 62" />
            <path d="M104.5 324c5 19 10 40 16 59" />
            <path d="M105 324c6 19 12 39 19 58" />
            <path d="M107 324c7 18 14 36 22 55" />
            <path d="M108 324c8 17 16 35 24 54" />
            <path d="M90 324c-10 16-19 33-28 50" />
            <path d="M110 324c10 16 19 33 28 50" />
          </g>
          <g stroke="#D9AE5F" strokeWidth=".7" opacity=".8">
            <path d="M93.5 325c-8 17-16 35-24 54" />
            <path d="M96.5 325c-6 19-11 39-17 57" />
            <path d="M98.5 325c-3 21-5 42-8 61" />
            <path d="M100.5 325c0 22 1 43 2 63" />
            <path d="M102.5 325c3 21 6 42 10 61" />
            <path d="M106 325c6 19 12 38 18 57" />
          </g>
          <g fill="#F3D9A4">
            <circle cx="66" cy="382" r="1.2" />
            <circle cx="76" cy="386" r="1.2" />
            <circle cx="86" cy="389" r="1.2" />
            <circle cx="98" cy="390" r="1.2" />
            <circle cx="110" cy="389" r="1.2" />
            <circle cx="122" cy="386" r="1.2" />
            <circle cx="134" cy="381" r="1.2" />
          </g>
        </g>
      </svg>
    </div>
  );
}

const PALACE_FRINGE = Array.from({ length: 38 }, (_, index) => {
  const t = index / 37;
  const xTop = 64 + t * 72;
  const xBottom = 58 + t * 84;
  const yBottom = 284 - Math.abs(t - 0.5) * 5 + (index % 2);
  return `M${xTop.toFixed(1)} 264L${xBottom.toFixed(1)} ${yBottom.toFixed(1)}`;
}).join(' ');

export function SpringPalaceLantern({
  className,
  style,
  delay = 0,
}: DecorProps & { delay?: number }) {
  const uid = useId().replace(/:/g, '');
  const panelId = `${uid}-panel`;
  const panelSideId = `${uid}-panel-side`;
  const goldId = `${uid}-gold`;
  const goldVId = `${uid}-gold-v`;
  const bronzeId = `${uid}-bronze`;
  const fringeId = `${uid}-fringe`;
  const tasselId = `${uid}-tassel`;
  const softId = `${uid}-soft`;
  const clipId = `${uid}-clip`;

  return (
    <div
      className={`spring-lantern${className ? ` ${className}` : ''}`}
      style={{ ...style, '--lantern-delay': `${delay}s` } as CSSProperties}
      aria-hidden="true"
    >
      <span className="spring-lantern-glow" />
      <svg viewBox="0 0 200 400" fill="none" className="spring-lantern-svg">
        <defs>
          <radialGradient id={panelId} cx="50%" cy="48%" r="66%">
            <stop offset="0%" stopColor="#FFCE86" />
            <stop offset="14%" stopColor="#F2904C" />
            <stop offset="38%" stopColor="#D9452C" />
            <stop offset="68%" stopColor="#A82419" />
            <stop offset="100%" stopColor="#6A110C" />
          </radialGradient>
          <radialGradient id={panelSideId} cx="50%" cy="46%" r="70%">
            <stop offset="0%" stopColor="#C96A3C" />
            <stop offset="45%" stopColor="#94251B" />
            <stop offset="100%" stopColor="#5A0C08" />
          </radialGradient>
          <linearGradient id={goldId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#5E3A12" />
            <stop offset="16%" stopColor="#B5812F" />
            <stop offset="36%" stopColor="#F7E3B4" />
            <stop offset="56%" stopColor="#E2BC72" />
            <stop offset="76%" stopColor="#A8762E" />
            <stop offset="100%" stopColor="#563510" />
          </linearGradient>
          <linearGradient id={goldVId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#563510" />
            <stop offset="20%" stopColor="#B5812F" />
            <stop offset="44%" stopColor="#F3D9A4" />
            <stop offset="70%" stopColor="#C99A45" />
            <stop offset="100%" stopColor="#6E4618" />
          </linearGradient>
          <linearGradient id={bronzeId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1B0E09" />
            <stop offset="50%" stopColor="#3D2418" />
            <stop offset="100%" stopColor="#160B07" />
          </linearGradient>
          <linearGradient id={fringeId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#F7E3B4" />
            <stop offset="38%" stopColor="#D9AE5F" />
            <stop offset="100%" stopColor="#8A5A23" />
          </linearGradient>
          <linearGradient id={tasselId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#E06045" />
            <stop offset="45%" stopColor="#B83226" />
            <stop offset="100%" stopColor="#6E130E" />
          </linearGradient>
          <filter id={softId} x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="7" />
          </filter>
          <clipPath id={clipId}>
            <path d="M56 110h88v134H56V110Z" />
          </clipPath>
        </defs>

        {/* 提绳与宝顶 */}
        <path d="M100 2v28" stroke="#D9AE5F" strokeWidth="1.2" />
        <path d="M99 2v28" stroke="#FFF0C8" strokeWidth=".35" opacity=".6" />
        <circle cx="100" cy="36" r="6" fill="none" stroke={`url(#${goldId})`} strokeWidth="1.8" />
        <circle cx="100" cy="36" r="1.8" fill="#F3D9A4" />
        <circle cx="100" cy="49" r="5" fill="#B83226" stroke="#D9AE5F" strokeWidth=".8" />

        {/* 宫灯鎏金顶盖 */}
        <path d="M64 60h72l-6 12H70l-6-12Z" fill={`url(#${goldId})`} />
        <path d="M70 72h60l-3 8H73l-3-8Z" fill={`url(#${goldVId})`} />
        <path d="M73 80h54" stroke="#6E4618" strokeWidth=".8" opacity=".65" />
        <g fill="#3A2418" opacity=".7">
          <circle cx="80" cy="67" r="1.1" />
          <circle cx="90" cy="65.5" r="1.1" />
          <circle cx="100" cy="65" r="1.1" />
          <circle cx="110" cy="65.5" r="1.1" />
          <circle cx="120" cy="67" r="1.1" />
        </g>
        <path d="M54 88c14-8 78-8 92 0l-6 9c-16-6-64-6-80 0l-6-9Z" fill={`url(#${goldId})`} />
        <path d="M48 86c3-5 7-7 12-5M152 86c-3-5-7-7-12-5" stroke="#F3D9A4" strokeWidth="1" opacity=".8" />
        <path d="M58 96h84" stroke="#F3D9A4" strokeWidth=".8" opacity=".55" />

        {/* 侧面 */}
        <path d="M56 110L36 122v116l20 12V110Z" fill={`url(#${panelSideId})`} />
        <path d="M144 110l20 12v116l-20 12V110Z" fill={`url(#${panelSideId})`} />
        {/* 正面绸面 */}
        <path d="M56 110h88v134H56V110Z" fill={`url(#${panelId})`} />
        <g clipPath={`url(#${clipId})`}>
          <ellipse cx="100" cy="177" rx="36" ry="54" fill="#FFE2A8" opacity=".22" filter={`url(#${softId})`} />
          <ellipse cx="78" cy="150" rx="12" ry="40" fill="#FFE0B0" opacity=".08" filter={`url(#${softId})`} />
          <ellipse cx="128" cy="202" rx="12" ry="34" fill="#5E0D0A" opacity=".18" filter={`url(#${softId})`} />
        </g>

        {/* 侧面板福字 */}
        <text
          x="46"
          y="180"
          textAnchor="middle"
          dominantBaseline="central"
          fontFamily="Songti SC, STSong, serif"
          fontSize="17"
          fontWeight="700"
          fill={`url(#${goldId})`}
          opacity=".92"
          transform="rotate(-6 46 180)"
        >
          福
        </text>
        <text
          x="154"
          y="180"
          textAnchor="middle"
          dominantBaseline="central"
          fontFamily="Songti SC, STSong, serif"
          fontSize="17"
          fontWeight="700"
          fill={`url(#${goldId})`}
          opacity=".92"
          transform="rotate(6 154 180)"
        >
          福
        </text>

        {/* 正面福字团花 */}
        <circle cx="100" cy="177" r="31" fill="none" stroke={`url(#${goldId})`} strokeWidth="2.2" />
        <circle cx="100" cy="177" r="27" fill="none" stroke="#F3D9A4" strokeWidth=".7" opacity=".7" />
        <text
          x="100"
          y="179"
          textAnchor="middle"
          dominantBaseline="central"
          fontFamily="Songti SC, STSong, serif"
          fontSize="36"
          fontWeight="700"
          fill={`url(#${goldId})`}
        >
          福
        </text>
        <g fill="#F3D9A4" opacity=".7">
          <circle cx="100" cy="140" r="1.4" />
          <circle cx="100" cy="214" r="1.4" />
          <circle cx="63" cy="177" r="1.4" />
          <circle cx="137" cy="177" r="1.4" />
        </g>

        {/* 描金框架 */}
        <g strokeLinejoin="round">
          <path d="M56 110h88v134H56V110Z" stroke="#3A1E0B" strokeWidth="7" opacity=".55" />
          <path d="M56 110h88v134H56V110Z" stroke={`url(#${goldId})`} strokeWidth="5" />
          <path d="M56 110L36 122v116l20 12" stroke="#3A1E0B" strokeWidth="6" opacity=".5" />
          <path d="M144 110l20 12v116l-20 12" stroke="#3A1E0B" strokeWidth="6" opacity=".5" />
          <path d="M56 110L36 122v116l20 12" stroke={`url(#${goldId})`} strokeWidth="4.2" />
          <path d="M144 110l20 12v116l-20 12" stroke={`url(#${goldId})`} strokeWidth="4.2" />
          <path d="M61 115h78v124H61V115Z" stroke="#F3D9A4" strokeWidth=".8" opacity=".55" />
          <path d="M61 115L45 125v108l16 10" stroke="#F3D9A4" strokeWidth=".6" opacity=".35" />
          <path d="M139 115l16 10v108l-16 10" stroke="#F3D9A4" strokeWidth=".6" opacity=".35" />
        </g>

        {/* 四角云纹 */}
        <g stroke="#F3D9A4" strokeWidth="1" opacity=".8">
          <path d="M63 117c5 0 8 3 8 8M137 117c-5 0-8 3-8 8M63 237c5 0 8-3 8-8M137 237c-5 0-8-3-8-8" />
          <path d="M45 128c4-2 7-1 8 2M155 128c-4-2-7-1-8 2M45 232c4 2 7 1 8-2M155 232c-4 2-7 1-8-2" />
        </g>

        {/* 上下描金箍 */}
        <path d="M56 244h88v8H56v-8Z" fill={`url(#${goldId})`} />
        <path d="M56 252h88v6H56v-6Z" fill={`url(#${bronzeId})`} />
        <path d="M60 258h80l4 8H56l4-8Z" fill={`url(#${goldVId})`} />
        <path d="M63 247h74" stroke="#FFF0C8" strokeWidth=".6" opacity=".55" />
        <g fill="#F3D9A4" opacity=".6">
          <circle cx="70" cy="248" r="1" />
          <circle cx="82" cy="248" r="1" />
          <circle cx="94" cy="248" r="1" />
          <circle cx="106" cy="248" r="1" />
          <circle cx="118" cy="248" r="1" />
          <circle cx="130" cy="248" r="1" />
        </g>

        {/* 金流苏 */}
        <path d={PALACE_FRINGE} stroke={`url(#${fringeId})`} strokeWidth=".8" opacity=".9" />
        <path d="M58 284h84l-1 4H59l-1-4Z" fill="#8A5A23" opacity=".22" />

        {/* 灯坠与红流苏 */}
        <path d="M93 292h14l-2 9h-10l-2-9Z" fill={`url(#${bronzeId})`} stroke="#D9AE5F" strokeWidth=".6" />
        <circle cx="100" cy="306" r="6" fill={`url(#${tasselId})`} stroke="#D9AE5F" strokeWidth=".8" />
        <path
          d="M91 314c4-4 14-4 18 0l-2 10c-4 4-10 4-14 0l-2-10Z"
          fill={`url(#${tasselId})`}
          stroke="#D9AE5F"
          strokeWidth=".5"
        />
        <rect x="91" y="314" width="18" height="3" rx="1.5" fill={`url(#${goldId})`} />
        <g className="spring-lantern-tassel" strokeLinecap="round">
          <path
            d="M68 326C60 346 52 366 47 383c15 6 34 9 53 9s38-3 53-9c-5-17-13-37-21-57Z"
            fill={`url(#${tasselId})`}
            opacity=".16"
            filter={`url(#${softId})`}
          />
          <g stroke={`url(#${tasselId})`} strokeWidth="2">
            <path d="M92 324c-8 17-16 35-24 54" />
            <path d="M93.5 324c-7 18-14 36-22 55" />
            <path d="M95 324c-6 19-11 39-17 58" />
            <path d="M96 324c-5 19-10 40-15 59" />
            <path d="M97 324c-3 21-5 42-8 62" />
            <path d="M98 324c-2 21-4 43-6 63" />
            <path d="M99 324c-1 22-2 43-3 64" />
            <path d="M100 324c0 22 0 44 1 65" />
            <path d="M101 324c1 22 2 43 4 64" />
            <path d="M102 324c2 21 4 43 7 63" />
            <path d="M103 324c3 21 6 42 10 62" />
            <path d="M104.5 324c5 19 10 40 16 59" />
            <path d="M105 324c6 19 12 39 19 58" />
            <path d="M107 324c7 18 14 36 22 55" />
            <path d="M108 324c8 17 16 35 24 54" />
            <path d="M90 324c-10 16-19 33-28 50" />
            <path d="M110 324c10 16 19 33 28 50" />
          </g>
          <g stroke="#D9AE5F" strokeWidth=".7" opacity=".8">
            <path d="M93.5 325c-8 17-16 35-24 54" />
            <path d="M96.5 325c-6 19-11 39-17 57" />
            <path d="M98.5 325c-3 21-5 42-8 61" />
            <path d="M100.5 325c0 22 1 43 2 63" />
            <path d="M102.5 325c3 21 6 42 10 61" />
            <path d="M106 325c6 19 12 38 18 57" />
          </g>
          <g fill="#F3D9A4">
            <circle cx="66" cy="382" r="1.2" />
            <circle cx="76" cy="386" r="1.2" />
            <circle cx="86" cy="389" r="1.2" />
            <circle cx="98" cy="390" r="1.2" />
            <circle cx="110" cy="389" r="1.2" />
            <circle cx="122" cy="386" r="1.2" />
            <circle cx="134" cy="381" r="1.2" />
          </g>
        </g>
      </svg>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 梅花枝                                                              */
/* ------------------------------------------------------------------ */

const BLOSSOMS: Array<{ x: number; y: number; s: number; r: number; tone: string }> = [
  { x: 300, y: 27, s: 1.12, r: 8, tone: '#C94534' },
  { x: 268, y: 41, s: 0.82, r: -18, tone: '#D96A52' },
  { x: 238, y: 54, s: 1.02, r: 26, tone: '#B83226' },
  { x: 205, y: 36, s: 0.9, r: 40, tone: '#E0A94E' },
  { x: 188, y: 68, s: 0.72, r: -8, tone: '#C94534' },
  { x: 196, y: 98, s: 1.06, r: 16, tone: '#B83226' },
  { x: 160, y: 91, s: 0.78, r: -32, tone: '#D96A52' },
  { x: 152, y: 128, s: 1.0, r: 6, tone: '#C94534' },
  { x: 122, y: 152, s: 0.84, r: 30, tone: '#B83226' },
  { x: 118, y: 115, s: 0.66, r: -16, tone: '#E0A94E' },
  { x: 92, y: 175, s: 1.04, r: -6, tone: '#C94534' },
  { x: 62, y: 200, s: 0.8, r: 22, tone: '#D96A52' },
  { x: 34, y: 216, s: 0.66, r: -24, tone: '#B83226' },
];

function PlumBlossom({ x, y, s, r, tone }: { x: number; y: number; s: number; r: number; tone: string }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${r}) scale(${s})`}>
      {[0, 72, 144, 216, 288].map((angle) => (
        <ellipse
          key={angle}
          cx="0"
          cy="-8.2"
          rx="5.4"
          ry="8.4"
          transform={`rotate(${angle})`}
          fill={tone}
          opacity=".95"
        />
      ))}
      <circle r="3.1" fill="#EFCB86" />
      <circle r="1.2" fill="#8E1C14" />
    </g>
  );
}

export function SpringPlumBranch({ className, style }: DecorProps) {
  return (
    <svg
      viewBox="0 0 340 280"
      fill="none"
      className={className}
      style={style}
      aria-hidden="true"
    >
      <g stroke="#6E3A2A" strokeLinecap="round">
        <path
          d="M338 10c-38 16-64 20-88 34-28 16-40 38-64 50-28 14-40 38-66 54-26 16-42 44-72 60-16 8-32 12-48 14"
          strokeWidth="4.6"
        />
        <path d="M232 58c-16-12-34-20-56-24" strokeWidth="2.5" opacity=".85" />
        <path d="M146 124c-18-12-34-16-54-16" strokeWidth="2.2" opacity=".8" />
        <path d="M206 72c2-14 2-24 10-36" strokeWidth="2" opacity=".75" />
      </g>
      <g stroke="#8A4A34" strokeWidth="1.2" strokeLinecap="round" opacity=".65">
        <path d="M298 24c-8 6-12 12-14 22" />
        <path d="M226 50c-6 10-6 18-4 28" />
        <path d="M186 92c-2 12 0 20 6 30" />
        <path d="M156 112c-8 8-14 12-24 14" />
        <path d="M122 142c-6 10-8 20-8 30" />
        <path d="M94 168c-10 6-18 8-28 10" />
      </g>
      {BLOSSOMS.map((blossom) => (
        <PlumBlossom key={`${blossom.x}-${blossom.y}`} {...blossom} />
      ))}
      <g fill="#8E4A34" opacity=".8">
        <circle cx="286" cy="18" r="2.4" />
        <circle cx="176" cy="30" r="2" />
        <circle cx="116" cy="104" r="1.8" />
        <circle cx="52" cy="190" r="2.1" />
      </g>
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* 祥云 / 窗棂 / 印章 / 分隔线 / 金屑                                  */
/* ------------------------------------------------------------------ */

export function SpringCloud({ className, style }: DecorProps) {
  return (
    <svg
      viewBox="0 0 140 70"
      fill="none"
      className={className}
      style={style}
      aria-hidden="true"
    >
      <path
        d="M9 49c-4.8-9.6 3.2-17.8 12.4-15.2C22 22 33.7 15.8 43 22.6c3.8-9.2 17-9.4 21.8.8 9.8-3.2 18.3 2.5 18.3 12.2 8.2-.2 13.4 4.8 13.4 11.6 0 7.6-6 12.4-14 12.4H21.2C13.7 59.6 9.2 54.8 9 49Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path
        d="M30 37.4c4.2-5.2 10.2-5.4 14.6-.8M70.4 36.2c4.2-5.2 10.2-5.4 14.6-.8"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
        opacity=".6"
      />
    </svg>
  );
}

export function SpringLatticeWindow({ className, style }: DecorProps) {
  const uid = useId().replace(/:/g, '');
  const patternId = `${uid}-lattice`;
  const clipId = `${uid}-clip`;

  return (
    <svg
      viewBox="0 0 400 400"
      fill="none"
      className={className}
      style={style}
      aria-hidden="true"
    >
      <defs>
        <pattern
          id={patternId}
          width="46"
          height="46"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <path d="M0 0h46M0 0v46" stroke="currentColor" strokeWidth="1" opacity=".55" />
        </pattern>
        <clipPath id={clipId}>
          <circle cx="200" cy="200" r="178" />
        </clipPath>
      </defs>
      <circle cx="200" cy="200" r="193" stroke="currentColor" strokeWidth="1.4" opacity=".55" />
      <circle cx="200" cy="200" r="184" stroke="currentColor" strokeWidth=".8" opacity=".3" />
      <g clipPath={`url(#${clipId})`}>
        <circle cx="200" cy="200" r="178" fill={`url(#${patternId})`} opacity=".6" />
      </g>
      <circle cx="200" cy="200" r="178" stroke="currentColor" strokeWidth="1.2" opacity=".4" />
      {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => {
        const rad = (angle * Math.PI) / 180;
        return (
          <circle
            key={angle}
            cx={200 + Math.cos(rad) * 193}
            cy={200 + Math.sin(rad) * 193}
            r="2.2"
            fill="currentColor"
            opacity=".5"
          />
        );
      })}
    </svg>
  );
}

export function SpringSeal({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={`spring-seal${className ? ` ${className}` : ''}`} aria-hidden="true">
      {children}
    </span>
  );
}

export function SpringDivider({ className }: { className?: string }) {
  return (
    <div
      className={`spring-divider${className ? ` ${className}` : ''}`}
      aria-hidden="true"
    >
      <span />
      <i />
      <span />
    </div>
  );
}

const PARTICLES = [
  { left: '7%', top: '72%', delay: '0s', duration: '12s', size: 3 },
  { left: '13%', top: '46%', delay: '2.4s', duration: '14s', size: 2 },
  { left: '22%', top: '83%', delay: '4.8s', duration: '11s', size: 3 },
  { left: '31%', top: '38%', delay: '1.2s', duration: '15s', size: 2 },
  { left: '40%', top: '68%', delay: '6.2s', duration: '13s', size: 2.5 },
  { left: '49%', top: '28%', delay: '3.1s', duration: '16s', size: 2 },
  { left: '57%', top: '76%', delay: '8.4s', duration: '12s', size: 3 },
  { left: '64%', top: '44%', delay: '5.3s', duration: '14s', size: 2 },
  { left: '72%', top: '86%', delay: '0.8s', duration: '13s', size: 2.5 },
  { left: '81%', top: '36%', delay: '7.2s', duration: '15s', size: 2 },
  { left: '88%', top: '63%', delay: '2.9s', duration: '12s', size: 3 },
  { left: '94%', top: '24%', delay: '6.8s', duration: '14s', size: 2 },
];

export function SpringParticles({ className }: { className?: string }) {
  return (
    <div
      className={`spring-particles${className ? ` ${className}` : ''}`}
      aria-hidden="true"
    >
      {PARTICLES.map((particle, index) => (
        <span
          key={`${particle.left}-${particle.top}-${index}`}
          className="spring-particle"
          style={{
            left: particle.left,
            top: particle.top,
            width: particle.size,
            height: particle.size,
            animationDelay: particle.delay,
            animationDuration: particle.duration,
          }}
        />
      ))}
    </div>
  );
}
