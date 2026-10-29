/**
 * The backend diagram on /how-it-works: learner's AI, course server, LRS (Learning Ledger) and Sensei, with the
 * MCP, xAPI, cmi5 launch and Open Badges flows. Two drawings of one picture: a wide one read left to right, and a tall
 * one for narrow screens. CSS shows one of them (src/styles/how.css). Solid strokes run here today, the dashed cmi5
 * launch is built but not wired in, and blue marks the one write path for learning facts.
 */

export const DIAGRAM_LABEL =
  'The backend. You chat with your own AI. Your AI talks to the course server over MCP. The course server writes xAPI ' +
  'statements to the LRS, Learning Ledger at lrs.sqwrlz.com, and is the only thing that writes to it. The LRS sends ' +
  'results to Sensei LMS through a signed webhook and a catch-up poll. Sensei can launch a lesson on the course server ' +
  'with a cmi5 launch. The LRS signs Open Badges 3.0 credentials, which you claim. All of this runs here today ' +
  'except the cmi5 launch, which is built but not wired in yet.';

function Heads({ id }: { id: string }) {
  return (
    <defs>
      <marker id={`${id}-ink`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M0 0L10 5L0 10z" class="dg-head" />
      </marker>
      <marker id={`${id}-write`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M0 0L10 5L0 10z" class="dg-head dg-head--write" />
      </marker>
    </defs>
  );
}

type BoxProps = { x: number; y: number; w: number; h: number; title: string; lines: [string, string]; top?: number };

function Box({ x, y, w, h, title, lines, top = 34 }: BoxProps) {
  const cx = x + w / 2;
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx="10" class="dg-box" />
      <text x={cx} y={y + top} text-anchor="middle" class="dg-title">{title}</text>
      <text x={cx} y={y + top + 24} text-anchor="middle" class="dg-sub">{lines[0]}</text>
      <text x={cx} y={y + top + 42} text-anchor="middle" class="dg-sub">{lines[1]}</text>
    </g>
  );
}

function You({ cx, cy }: { cx: number; cy: number }) {
  return (
    <g>
      <rect x={cx - 40} y={cy - 18} width="80" height="36" rx="18" class="dg-box dg-box--you" />
      <text x={cx} y={cy + 6} text-anchor="middle" class="dg-title dg-title--small">You</text>
    </g>
  );
}

const AI: [string, [string, string]] = ["Learner's AI", ['Claude, ChatGPT,', 'Cursor, any MCP client']];
const SERVER: [string, [string, string]] = ['Course server', ['Spacefast Functions', 'the only writer']];
const LRS: [string, [string, string]] = ['LRS', ['Learning Ledger', 'lrs.sqwrlz.com']];
const SENSEI: [string, [string, string]] = ['Sensei LMS', ['+ Ledger connector', 'WordPress, space A']];

function Wide() {
  const id = 'hw-wide';
  const ink = `url(#${id}-ink)`;
  const write = `url(#${id}-write)`;
  const y = 150;
  const h = 104;
  const mid = y + h / 2;
  return (
    <svg class="how-diagram__wide" viewBox="0 0 960 404" role="img" aria-label={DIAGRAM_LABEL} focusable="false">
      <Heads id={id} />
      <You cx={82} cy={58} />
      <line x1="82" y1="80" x2="82" y2="146" class="dg-line" marker-start={ink} marker-end={ink} />
      <text x="94" y="118" class="dg-detail">chats</text>

      <Box x={2} y={y} w={160} h={h} title={AI[0]} lines={AI[1]} />
      <Box x={268} y={y} w={160} h={h} title={SERVER[0]} lines={SERVER[1]} />
      <Box x={534} y={y} w={160} h={h} title={LRS[0]} lines={LRS[1]} />
      <Box x={798} y={y} w={160} h={h} title={SENSEI[0]} lines={SENSEI[1]} />

      <line x1="166" y1={mid} x2="264" y2={mid} class="dg-line" marker-start={ink} marker-end={ink} />
      <text x="215" y={mid - 12} text-anchor="middle" class="dg-label">MCP</text>
      <text x="215" y={mid + 22} text-anchor="middle" class="dg-detail">tool calls</text>

      <line x1="432" y1={mid} x2="530" y2={mid} class="dg-line dg-line--write" marker-end={write} />
      <text x="481" y={mid - 26} text-anchor="middle" class="dg-label dg-label--write">xAPI</text>
      <text x="481" y={mid - 12} text-anchor="middle" class="dg-label dg-label--write">statements</text>
      <text x="481" y={mid + 22} text-anchor="middle" class="dg-detail">real time</text>

      <line x1="698" y1={mid} x2="794" y2={mid} class="dg-line dg-line--write" marker-end={write} />
      <text x="746" y={mid - 12} text-anchor="middle" class="dg-label dg-label--write">results</text>
      <text x="746" y={mid + 22} text-anchor="middle" class="dg-detail">signed webhook</text>
      <text x="746" y={mid + 37} text-anchor="middle" class="dg-detail">+ catch-up poll</text>

      <path d={`M878 ${y + h} V322 H348 V${y + h + 4}`} class="dg-line dg-line--next" marker-end={ink} />
      <text x="613" y="312" text-anchor="middle" class="dg-label">cmi5 launch</text>
      <text x="613" y="342" text-anchor="middle" class="dg-detail">when Sensei launches a lesson</text>

      <path d={`M614 ${y} V58 H126`} class="dg-line" marker-end={ink} />
      <text x="370" y="48" text-anchor="middle" class="dg-label">Open Badges 3.0</text>
      <text x="370" y="78" text-anchor="middle" class="dg-detail">signed by the LRS, claimed by you</text>

      <g class="dg-legend">
        <line x1="2" y1="392" x2="38" y2="392" class="dg-line" />
        <text x="46" y="396" class="dg-detail">runs here today</text>
        <line x1="190" y1="392" x2="226" y2="392" class="dg-line dg-line--next" />
        <text x="234" y="396" class="dg-detail">built, not wired in</text>
        <line x1="470" y1="392" x2="506" y2="392" class="dg-line dg-line--write" />
        <text x="514" y="396" class="dg-detail">the one write path for learning facts</text>
      </g>
    </svg>
  );
}

function Tall() {
  const id = 'hw-tall';
  const ink = `url(#${id}-ink)`;
  const write = `url(#${id}-write)`;
  const x = 80;
  const w = 200;
  const h = 88;
  const ys = [96, 252, 408, 564];
  return (
    <svg class="how-diagram__tall" viewBox="0 0 360 712" role="img" aria-label={DIAGRAM_LABEL} focusable="false">
      <Heads id={id} />
      <You cx={180} cy={26} />
      <line x1="180" y1="48" x2="180" y2="92" class="dg-line" marker-start={ink} marker-end={ink} />
      <text x="192" y="76" class="dg-detail">chats</text>

      <Box x={x} y={ys[0]} w={w} h={h} title={AI[0]} lines={AI[1]} top={30} />
      <Box x={x} y={ys[1]} w={w} h={h} title={SERVER[0]} lines={SERVER[1]} top={30} />
      <Box x={x} y={ys[2]} w={w} h={h} title={LRS[0]} lines={LRS[1]} top={30} />
      <Box x={x} y={ys[3]} w={w} h={h} title={SENSEI[0]} lines={SENSEI[1]} top={30} />

      <line x1="180" y1="188" x2="180" y2="248" class="dg-line" marker-start={ink} marker-end={ink} />
      <text x="192" y="214" class="dg-label">MCP</text>
      <text x="192" y="230" class="dg-detail">tool calls</text>

      <line x1="180" y1="344" x2="180" y2="404" class="dg-line dg-line--write" marker-end={write} />
      <text x="192" y="370" class="dg-label dg-label--write">xAPI statements</text>
      <text x="192" y="386" class="dg-detail">real time</text>

      <line x1="180" y1="500" x2="180" y2="560" class="dg-line dg-line--write" marker-end={write} />
      <text x="192" y="526" class="dg-label dg-label--write">results</text>
      <text x="192" y="542" class="dg-detail">webhook + poll</text>

      <path d="M80 608 H34 V296 H76" class="dg-line dg-line--next" marker-end={ink} />
      <text x="22" y="452" text-anchor="middle" transform="rotate(-90 22 452)" class="dg-label">cmi5 launch</text>

      <path d="M280 452 H326 V26 H224" class="dg-line" marker-end={ink} />
      <text x="344" y="240" text-anchor="middle" transform="rotate(-90 344 240)" class="dg-label">Open Badges 3.0</text>

      <g class="dg-legend">
        <line x1="0" y1="694" x2="24" y2="694" class="dg-line" />
        <text x="30" y="698" class="dg-detail">runs today</text>
        <line x1="116" y1="694" x2="140" y2="694" class="dg-line dg-line--next" />
        <text x="146" y="698" class="dg-detail">not wired in</text>
        <line x1="240" y1="694" x2="264" y2="694" class="dg-line dg-line--write" />
        <text x="270" y="698" class="dg-detail">write path</text>
      </g>
    </svg>
  );
}

export function BackendDiagram() {
  return (
    <figure class="how-diagram">
      <Wide />
      <Tall />
      <figcaption>
        The backend this site runs. The solid parts run today: your AI talks to this site's course server over MCP, the
        course server writes to the LRS, the LRS tells Sensei, and the LRS signs your badges. The dashed cmi5 launch is
        built but not connected yet. Blue is the only path learning facts take, from the course server to the LRS to
        Sensei, never the other way.
      </figcaption>
    </figure>
  );
}
