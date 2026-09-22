import { ArrowUpRight } from 'lucide-react'

export function BrandPanel() {
  return (
    <aside className="brand-panel" aria-label="CEP Horas, sua jornada em perspectiva">
      <div className="brand-panel-content">
        <div className="product-tag">
          <span /> CEP HORAS
        </div>
        <h1>
          Mais clareza
          <br />
          para a sua
          <br />
          <span>jornada.</span>
        </h1>
        <p>
          Um novo olhar sobre o seu tempo.
          <br />
          Seus registros, juntos em um só lugar.
        </p>
      </div>
      <div className="architecture" aria-hidden="true">
        <svg viewBox="0 0 620 430" fill="none">
          <defs>
            <linearGradient
              id="plane"
              x1="350"
              y1="60"
              x2="180"
              y2="360"
              gradientUnits="userSpaceOnUse"
            >
              <stop stopColor="#f58239" />
              <stop offset="1" stopColor="#c84d0d" />
            </linearGradient>
            <linearGradient
              id="side"
              x1="90"
              y1="270"
              x2="440"
              y2="390"
              gradientUnits="userSpaceOnUse"
            >
              <stop stopColor="#75746f" />
              <stop offset="1" stopColor="#3b3c39" />
            </linearGradient>
          </defs>
          <g stroke="#666760" strokeWidth=".7" opacity=".4">
            <path d="M-40 230 330 16 690 224M-40 270 330 56 690 264M-40 310 330 96 690 304M-40 350 330 136 690 344M-40 390 330 176 690 384M-40 430 330 216 690 424" />
            <path d="m70 166 360 208M140 126l360 208M210 86l360 208M280 46l360 208M0 206l360 208" />
          </g>
          <path d="m119 245 192-111 192 111-192 111z" fill="#343632" stroke="#93948b" />
          <path d="M119 245v35l192 111v-35z" fill="url(#side)" />
          <path d="M311 356v35l192-111v-35z" fill="#4b4d46" />
          <path d="M167 218V146L311 63l144 83v72l-144 83z" fill="url(#plane)" />
          <path d="m167 146 144 83 144-83M311 229v72" stroke="#ffb486" strokeWidth="1.4" />
          <path d="m215 174 96-55 96 55-96 55z" fill="#282a27" />
          <path d="m215 174 96-55v-56M407 174l-96-55" stroke="#fba571" />
          <g stroke="#b3b4a9" strokeWidth=".8" strokeDasharray="4 6" opacity=".7">
            <path d="M311 9v49M311 306v103M89 127l71 41M465 172l63-36M118 285v49M504 285v49" />
          </g>
          <g stroke="#919389" strokeWidth=".8">
            <path d="m89 313 223 129M84 308l10 12M307 436l10 12M527 311 368 403M522 307l10 12" />
          </g>
          <circle cx="311" cy="63" r="4" fill="#f79a63" />
          <circle cx="119" cy="245" r="3" fill="#a8aaa0" />
        </svg>
      </div>
      <div className="brand-panel-footer">
        <span>CONCEITO ENGENHARIA</span>
        <ArrowUpRight size={21} strokeWidth={1.4} />
      </div>
    </aside>
  )
}
