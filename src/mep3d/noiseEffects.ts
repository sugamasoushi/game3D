/** ノイズ素材を使うフィールド演出。描画はゲームとエディタで共有する。 */
export const NOISE_EFFECTS = {
  miasma: { label: '瘴気', color: '#9c51ba', thick: 1.5, speed: 0.3, scale: 1, flat: true, additive: false, layers: 4, a: '/assets/noise/Perlin/Perlin 19 - 512x512.png', b: '/assets/noise/Super Perlin/Super Perlin 14 - 512x512.png', help: '床に低く漂う紫の霧。白にすると朝霧になります。厚みで漂う高さを調整します。' },
  waterfall: { label: '滝・流水', color: '#a2dcff', thick: 5, speed: 1, scale: 1.5, flat: false, additive: false, layers: 1, a: '/assets/noise/Streak/Streak 4 - 512x512.png', b: '/assets/noise/Super Perlin/Super Perlin 5 - 512x512.png', help: '縦面に描くと下へ流れる滝になります。底には白い泡が広がります。床配置でも縦に立ちます。' },
  caustics: { label: '水中のゆらめく光', color: '#a5f4ff', thick: 0.5, speed: 0.4, scale: 2, flat: true, additive: true, layers: 1, a: '/assets/noise/Super Perlin/Super Perlin 11 - 512x512.png', b: '/assets/noise/Milky/Milky 3 - 512x512.png', help: '川底や壁に網目状の光を重ねます。床は配置面の少し上、壁は縦面に描いてください。' },
  lava: { label: '溶岩・魔力の亀裂', color: '#ff500b', thick: 0.5, speed: 0.6, scale: 2, flat: true, additive: true, layers: 1, a: '/assets/noise/Cracks/Cracks 5 - 512x512.png', b: '/assets/noise/Perlin/Perlin 19 - 512x512.png', help: 'ひびの線から光が漏れ、ゆっくり脈打ちます。橙は溶岩、紫は魔力。熱気や煙は別に重ねられます。' },
  frost: { label: '凍結・氷の亀裂', color: '#b9efff', thick: 0.5, speed: 0.5, scale: 2, flat: true, additive: false, layers: 1, a: '/assets/noise/Cracks/Cracks 3 - 512x512.png', b: '/assets/noise/Voronoi/Voronoi 10 - 512x512.png', help: '中心から白い霜と氷の亀裂が広がります。速さ1で約6秒周期、0で凍った状態。床・壁に配置できます。' },
  portal: { label: '転移門・魔力の渦', color: '#508dff', thick: 4, speed: 0.7, scale: 1.5, flat: false, additive: false, layers: 1, a: '/assets/noise/Swirl/Swirl 6 - 512x512.png', b: '/assets/noise/Turbulence/Turbulence 9 - 512x512.png', help: '光る縁の内側で渦が中心へ吸い込まれます。床配置は上へ立つ門、縦面ではその面に向きます。移動先や当たりは別設定です。' },
  barrier: { label: '結界・古代装置', color: '#ffcf65', thick: 4, speed: 0.6, scale: 2, flat: false, additive: true, layers: 1, a: '/assets/noise/Techno/Techno 5 - 512x512.png', b: '/assets/noise/Techno/Techno 14 - 512x512.png', help: '回路の線に光が走る結界。縦面に描いて入口を覆います。通行を止める当たりは別設定です。' },
  shockwave: { label: '衝撃波・発動光', color: '#ffe7a0', thick: 0.5, speed: 1, scale: 1, flat: true, additive: true, layers: 1, a: '/assets/noise/Spokes/Spokes 6 - 512x512.png', b: '/assets/noise/Perlin/Perlin 24 - 512x512.png', help: '閃光と放射状の筋から、光の輪が外へ広がります。速さ1で約3秒周期、0で輪を静止表示。縦面にも置けます。' },
  bubbling: { label: '毒沼・煮え立つ液体', color: '#6bba36', thick: 0.5, speed: 0.7, scale: 2, flat: true, additive: false, layers: 1, a: '/assets/noise/Craters/Craters 11 - 512x512.png', b: '/assets/noise/Milky/Milky 2 - 512x512.png', help: '液面の泡が場所ごとに膨らんで消えます。色を紫なら毒、赤なら煮え立つ液体に。ダメージは伴いません。' },
  heat: { label: '陽炎・空間のゆがみ', color: '#ffffff', thick: 3, speed: 0.7, scale: 1.5, flat: false, additive: false, layers: 1, a: '/assets/noise/Melt/Melt 11 - 512x512.png', b: '/assets/noise/Perlin/Perlin 24 - 512x512.png', help: '背後の画面を揺らす透明な熱気。詳しくの「ゆがみ」で強さを調整します。炎の上や転移門の周囲に配置できます。' },
  dissolve: { label: '灰になって消える', color: '#ff812d', thick: 4, speed: 1, scale: 2, flat: false, additive: true, layers: 1, a: '/assets/noise/Grainy/Grainy 3 - 512x512.png', b: '/assets/noise/Super Noise/Super Noise 7 - 512x512.png', help: '範囲内の物の絵をノイズ状に消し、縁を光らせます。速さ1で約6秒の消失・復帰の試演。0では「進み具合」で固定。地形も対象になるため床より少し上に配置します。当たりやイベントは消しません。' },
  appear: { label: '魔力で出現する', color: '#559dff', thick: 4, speed: 1, scale: 2, flat: false, additive: true, layers: 1, a: '/assets/noise/Grainy/Grainy 3 - 512x512.png', b: '/assets/noise/Super Noise/Super Noise 7 - 512x512.png', help: '範囲内の物の絵が光る輪郭から現れます。速さ1で約6秒の出現・消失の試演。0では「進み具合」で固定。対象の位置に範囲を描いてください。当たりやイベントは変わりません。' },
} as const;
export type NoiseEffectKind = keyof typeof NOISE_EFFECTS;
export const NOISE_EFFECT_KINDS = Object.keys(NOISE_EFFECTS) as NoiseEffectKind[];
export function isNoiseEffect(kind: string): kind is NoiseEffectKind { return Object.hasOwn(NOISE_EFFECTS, kind); }

export const noiseEffectVertexShader = `
varying vec2 vUv;
varying vec4 vNoiseClip;
void main() {
  vUv = uv;
  vNoiseClip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = vNoiseClip;
}
`;

const prelude = `
precision highp float;
uniform sampler2D mapA;
uniform sampler2D mapB;
uniform sampler2D sceneMap;
uniform float sceneOn;
uniform vec2 noisePixel;
uniform vec3 tint;
uniform float amount;
uniform float time;
uniform float speed;
uniform float scale;
uniform float level;
uniform float warp;
uniform float richness;
varying vec2 vUv;
varying vec4 vNoiseClip;
float edge(vec2 p) { vec2 e = min(p, 1.0-p); return smoothstep(0.0,0.10,min(e.x,e.y)); }
float hash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
vec2 rotate(vec2 p,float a) { float s=sin(a),c=cos(a);return mat2(c,-s,s,c)*p; }
// テクスチャの層に重ねる微光。乱数は位置で固定し、速さ0で光も静止する。
float stars(vec2 p,float t,float density) {
  vec2 grid=p*density;
  vec2 cell=floor(grid);
  vec2 center=vec2(hash(cell+0.7),hash(cell+8.3))*0.6+0.2;
  vec2 d=fract(grid)-center;
  float pulse=pow(0.5+0.5*sin(t*2.0+hash(cell)*6.28318),5.0);
  return exp(-dot(d,d)*180.0)*pulse;
}
float softRing(float distance,float radius,float width) {
  return exp(-pow((distance-radius)/max(width,0.001),2.0));
}
void main() {
  vec2 uv=vUv;
  float t=time*speed;
  vec2 p=uv*scale;
  float a=texture2D(mapA,p+vec2(t*0.07,-t*0.11)+level*0.71).r;
  float b=texture2D(mapB,p*1.57+vec2(-t*0.09,t*0.04)+level*0.93).r;
  float alpha=0.0;
  vec3 rgb=tint;
`;

const bodies: Record<NoiseEffectKind, string> = {
  miasma: `alpha=smoothstep(0.25,0.8,a*0.7+b*0.6)*edge(uv)*(1.0-level*0.75)*0.5; rgb*=0.8+b*0.35;`,
  waterfall: `
    float stream=texture2D(mapA,vec2(p.y+t*0.85,p.x)).r;
    float detail=texture2D(mapB,vec2(p.x*1.8,p.y*0.7+t*1.4)).r;
    float foam=(1.0-smoothstep(0.0,0.22,uv.y))*smoothstep(0.25,0.7,a+b*0.4);
    rgb=mix(tint,vec3(1.0),clamp(stream*0.55+foam,0.0,1.0));
    alpha=edge(uv)*(0.25+stream*0.4+detail*0.2+foam*0.35);`,
  caustics: `
    vec2 flow=p+vec2(b-0.5,a-0.5)*0.18;
    float n=texture2D(mapA,flow+vec2(t*0.09,t*0.04)).r;
    alpha=pow(smoothstep(0.47,0.88,n),2.0)*edge(uv)*(0.6+0.4*b);`,
  lava: `
    float cracks=1.0-texture2D(mapA,p).r;
    float glow=smoothstep(0.035,0.26,cracks);
    float pulse=0.65+0.35*sin(t*2.0+b*5.0);
    rgb=mix(tint,vec3(1.0,0.9,0.55),pow(glow,4.0)*0.7);
    alpha=glow*pulse*edge(uv);`,
  frost: `
    float phase=speed<0.001 ? 1.0 : smoothstep(0.0,0.65,fract(t/6.0));
    float spread=1.0-smoothstep(phase*0.85-0.04,phase*0.85+0.05,length(uv-0.5)+(b-0.5)*0.07);
    float cracks=1.0-texture2D(mapA,p).r;
    float vein=1.0-texture2D(mapB,p*0.8).r;
    rgb=mix(tint,vec3(1.0),cracks*0.75);
    alpha=spread*edge(uv)*(0.45+cracks*0.5+vein*0.2);`,
  portal: `
    vec2 q=(uv-0.5)*2.0;
    float r=length(q);
    float theta=atan(q.y,q.x);
    vec2 polar=vec2(theta/6.283185+t*0.10,r*scale+t*0.26);
    float vortex=texture2D(mapA,polar).r;
    float streak=texture2D(mapB,polar*vec2(2.0,1.0)+vortex*0.15).r;
    float rim=exp(-pow((r-0.86)*24.0,2.0));
    float inside=(1.0-smoothstep(0.82,0.9,r));
    rgb=tint*(0.08+vortex*0.6+streak*0.3)+rim*tint*1.5;
    alpha=inside*0.92+rim*0.8;`,
  barrier: `
    float circuit=texture2D(mapA,p).r;
    float cells=texture2D(mapB,p*0.7).r;
    float scan=exp(-pow((fract(uv.y-t*0.18)-0.5)*14.0,2.0));
    float lines=smoothstep(0.48,0.8,circuit);
    rgb=tint*(0.5+scan*1.8);
    alpha=edge(uv)*(lines*(0.25+scan*0.65)+smoothstep(0.7,0.92,cells)*0.13);`,
  shockwave: `
    vec2 q=(uv-0.5)*2.0;
    float r=length(q);
    float phase=speed<0.001 ? 0.48 : fract(t/3.0);
    float radius=0.04+phase*1.1;
    float ring=exp(-pow((r-radius)*32.0,2.0))*(1.0-phase);
    float spokes=texture2D(mapA,uv).r;
    float flash=exp(-phase*22.0)*exp(-r*5.0);
    alpha=edge(uv)*(ring+flash*(0.4+spokes)*1.5);`,
  bubbling: `
    vec2 cell=floor(p*3.0);
    vec2 local=fract(p*3.0)-0.5;
    float phase=fract(t*0.45+hash(cell));
    vec2 center=(vec2(hash(cell+1.0),hash(cell+9.0))-0.5)*0.3;
    float radius=0.05+0.28*phase;
    float bubble=exp(-pow((length(local-center)-radius)*40.0,2.0))*sin(phase*3.14159);
    float pits=texture2D(mapA,p+sin(t*0.2)*0.02).r;
    rgb=tint*(0.35+pits*0.6)+bubble*vec3(0.55,0.65,0.42);
    alpha=edge(uv)*0.9;`,
  heat: `
    if(sceneOn<0.5) discard;
    vec2 screen=vNoiseClip.xy/vNoiseClip.w*0.5+0.5;
    vec2 offset=(vec2(a,b)-0.5)*warp*0.025*edge(uv);
    vec2 sampleUv=clamp(screen+offset,noisePixel*0.5,1.0-noisePixel*0.5);
    rgb=texture2D(sceneMap,sampleUv).rgb;
    alpha=edge(uv);`,
  dissolve: `discard;`,
  appear: `discard;`,
};

/** 元の画に、種類ごとの光・微粒子・二重の流れを合成する。0なら従来の画。 */
const richBodies: Record<NoiseEffectKind, string> = {
  miasma: `
    vec2 curl=vec2(a-0.5,b-0.5)*0.5;
    float folds=texture2D(mapB,p*0.7+curl+vec2(t*0.05,-t*0.08)).r;
    float wisps=smoothstep(0.4,0.8,folds);
    float dust=stars(uv+vec2(level*0.17,-t*0.025),t+level,9.0);
    rgb+=richness*(tint*wisps*0.8+vec3(0.65,0.9,1.0)*dust*1.8);
    alpha+=richness*edge(uv)*(wisps*0.12+dust*0.35)*(1.0-level*0.5);`,
  waterfall: `
    float ribbons=texture2D(mapB,vec2(p.x*2.5+(a-0.5)*0.08,p.y+t*2.0)).r;
    float glints=pow(max(0.0,ribbons),5.0);
    float splash=stars(vec2(uv.x,uv.y*2.0+t*0.09),t,12.0)*(1.0-smoothstep(0.0,0.35,uv.y));
    float mist=exp(-uv.y*12.0)*(0.5+0.5*b);
    rgb+=richness*(vec3(0.65,0.85,1.0)*glints+vec3(1.0)*(splash*2.0+mist*0.6));
    alpha+=richness*edge(uv)*(glints*0.2+splash*0.4+mist*0.18);`,
  caustics: `
    float second=texture2D(mapB,rotate(p-0.5,sin(t*0.3)*0.08)+vec2(t*0.04,-t*0.07)+vec2(b-0.5,a-0.5)*0.2).r;
    float lace=pow(smoothstep(0.43,0.82,second),3.0);
    float glints=stars(uv,t,14.0)*lace;
    rgb+=richness*(tint*lace*1.2+vec3(0.8,0.95,1.0)*glints*2.0);
    alpha+=richness*edge(uv)*(lace*0.4+glints*0.5);`,
  lava: `
    float c=1.0-texture2D(mapA,p).r;
    float core=smoothstep(0.2,0.55,c);
    float halo=smoothstep(0.005,0.18,c);
    float current=0.5+0.5*sin(p.x*8.0+p.y*5.0-t*4.0+b*5.0);
    float ember=stars(uv+vec2(t*0.01,-t*0.04),t,12.0)*halo;
    rgb+=richness*(tint*halo*1.0+mix(tint,vec3(1.0,0.95,0.6),core)*core*(0.6+current)+vec3(1.0,0.8,0.4)*ember*2.0);
    alpha+=richness*edge(uv)*(halo*0.22+core*0.4+ember*0.5);`,
  frost: `
    float phaseR=speed<0.001?1.0:smoothstep(0.0,0.65,fract(t/6.0));
    float distR=length(uv-0.5)+(b-0.5)*0.07;
    float frozen=1.0-smoothstep(phaseR*0.85-0.04,phaseR*0.85+0.05,distR);
    float front=softRing(distR,phaseR*0.85,0.035)*(1.0-step(0.98,phaseR));
    float crystals=stars(uv,t*0.5,16.0)*frozen;
    float veinsR=pow(1.0-texture2D(mapB,p*0.8).r,2.0);
    rgb+=richness*(tint*front*1.7+vec3(0.8,0.95,1.0)*(crystals*2.2+veinsR*frozen));
    alpha+=richness*edge(uv)*(front*0.5+crystals*0.6);`,
  portal: `
    vec2 qR=(uv-0.5)*2.0;
    float rR=length(qR);
    float thetaR=atan(qR.y,qR.x);
    float outer=softRing(rR,0.94,0.012)*(0.35+0.65*pow(0.5+0.5*sin(thetaR*12.0-t*2.0),3.0));
    float inner=softRing(rR,0.72,0.016)*(0.3+0.7*pow(0.5+0.5*sin(thetaR*6.0+t*3.0),5.0));
    float halo=softRing(rR,0.86,0.09);
    float orbit=stars(vec2(fract(thetaR/6.283185-t*0.08),rR),t,14.0)*softRing(rR,0.84,0.08);
    float spiral=pow(0.5+0.5*sin(thetaR*4.0+rR*24.0+t*4.0+a*2.0),12.0)*(1.0-smoothstep(0.65,0.87,rR))*smoothstep(0.0,0.2,rR);
    rgb+=richness*(tint*(outer*2.5+inner*1.7+halo*0.5+spiral*0.65)+vec3(0.7,0.85,1.0)*orbit*3.0);
    alpha+=richness*(outer*0.8+inner*0.5+halo*0.2+orbit*0.7);`,
  barrier: `
    float circuitsR=texture2D(mapA,p).r;
    float pulse=pow(0.5+0.5*sin(uv.y*16.0+uv.x*5.0-t*5.0),10.0);
    float wave=softRing(length(uv-0.5),fract(t*0.16)*0.9,0.025);
    float runes=stars(uv+vec2(0.0,t*0.02),t,10.0)*smoothstep(0.35,0.8,circuitsR);
    rgb+=richness*(tint*(pulse*circuitsR*2.0+wave*1.5)+vec3(1.0,0.9,0.7)*runes*2.0);
    alpha+=richness*edge(uv)*(pulse*circuitsR*0.5+wave*0.4+runes*0.6);`,
  shockwave: `
    float rR=length((uv-0.5)*2.0);
    float phaseR=speed<0.001?0.48:fract(t/3.0);
    float r1=0.04+phaseR*1.1;
    float r2=max(0.0,r1-0.16);
    float halo=softRing(rR,r1,0.09)*(1.0-phaseR);
    float echo=softRing(rR,r2,0.014)*(1.0-phaseR)*smoothstep(0.1,0.3,phaseR);
    float streaks=pow(texture2D(mapA,uv).r,4.0)*exp(-abs(rR-r1)*8.0)*(1.0-phaseR);
    rgb+=richness*(tint*(halo*1.2+echo*2.0)+vec3(1.0,0.92,0.75)*streaks);
    alpha+=richness*edge(uv)*(halo*0.5+echo*0.8+streaks*0.35);`,
  bubbling: `
    vec2 gR=p*3.0;
    vec2 idR=floor(gR);
    vec2 localR=fract(gR)-0.5;
    float phaseR=fract(t*0.45+hash(idR));
    vec2 centerR=(vec2(hash(idR+1.0),hash(idR+9.0))-0.5)*0.3;
    float radiusR=0.05+0.28*phaseR;
    float distR=length(localR-centerR);
    float dome=(1.0-smoothstep(0.0,radiusR,distR))*sin(phaseR*3.14159);
    float spec=exp(-dot(localR-centerR-vec2(-0.06,0.07),localR-centerR-vec2(-0.06,0.07))*900.0)*dome;
    float ripple=softRing(distR,radiusR+max(0.0,phaseR-0.65)*0.35,0.018)*smoothstep(0.6,0.8,phaseR)*(1.0-phaseR)*4.0;
    float veins=pow(texture2D(mapB,p+vec2(t*0.02,-t*0.015)).r,4.0);
    rgb+=richness*(tint*(dome*0.65+ripple*0.7+veins*0.5)+vec3(0.8,1.0,0.65)*spec*2.0);
    alpha+=richness*edge(uv)*ripple*0.15;`,
  heat: `
    vec2 screenR=vNoiseClip.xy/vNoiseClip.w*0.5+0.5;
    vec2 flowR=vec2(texture2D(mapA,p*0.55+vec2(t*0.06,-t*0.22)).r,texture2D(mapB,p*0.7+vec2(-t*0.03,-t*0.18)).r)-0.5;
    vec2 waveR=(vec2(a,b)-0.5)+flowR*richness*1.2;
    vec2 bendR=waveR*warp*0.025*edge(uv);
    vec2 halfPixel=noisePixel*0.5;
    vec2 centerR=clamp(screenR+bendR,halfPixel,1.0-halfPixel);
    vec3 refractR=texture2D(sceneMap,centerR).rgb;
    vec2 splitR=waveR*warp*0.0025*richness*edge(uv);
    refractR.r=texture2D(sceneMap,clamp(centerR+splitR,halfPixel,1.0-halfPixel)).r;
    refractR.b=texture2D(sceneMap,clamp(centerR-splitR,halfPixel,1.0-halfPixel)).b;
    rgb=mix(rgb,refractR,richness);`,
  dissolve: ``,
  appear: ``,
};

export function noiseEffectShader(kind: NoiseEffectKind): string {
  return prelude + bodies[kind] + `
    if(richness>0.001) {
      ${richBodies[kind]}
    }
    gl_FragColor=vec4(rgb,clamp(alpha*amount,0.0,1.0));
  }`;
}

/** 自動試演は消失/復帰を6秒で一巡。停止時は進捗をそのまま使う。 */
export function dissolveProgress(time: number, speed: number, progress: number, appear: boolean): number {
  const p = speed <= 0 ? Math.max(0, Math.min(1, progress)) : Math.min(1, (time * speed % 6) / 2);
  const cycle = speed <= 0 ? p : (time * speed % 6 < 3 ? p : Math.max(0, 1 - (time * speed % 6 - 3) / 2));
  return appear ? 1 - cycle : cycle;
}
