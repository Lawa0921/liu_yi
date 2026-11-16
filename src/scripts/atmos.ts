// 首屏的體積光與空氣（第四輪）：一張原生 WebGL2 的全螢幕著色器，畫在院門與人形之間（Scene.astro 的 atmos 層）。
// 院門門洞射出的逆光（god rays，角度方向的噪聲光柱，緩慢呼吸）、屋脊後流動的霧、地面被光打亮的一片、
// 光柱裡翻滾的浮塵（三層景深：近的大而快、遠的小而慢）。不用 three；低解析度、最多 30fps、畫面外不畫。
// 「減少動態」只畫一格靜態的光。不支援 WebGL2（或建立失敗）時回傳 false，場景照舊用 CSS 光束。
//
//   canvas[data-atmos-canvas] data-atmos-frames   畫了幾格

import { ATMOS, atmosFrameDue } from '../lib/scene/atmos';

const VERTEX = `#version 300 es
in vec2 p;
void main(){gl_Position=vec4(p,0.,1.);}`;

// 顏色只用古金與米白（設計變數換算成 RGB 傳進來）；粒子是一顆一顆的亮點，不是暈開的墨。
const FRAGMENT = `#version 300 es
precision mediump float;
uniform vec2 uRes;uniform float uTime;uniform vec2 uSrc;uniform vec2 uPtr;uniform float uHorizon;uniform vec3 uGold;uniform vec3 uHot;uniform float uShaft;uniform float uAlpha;uniform float uFloor;uniform float uRayFloor;
out vec4 o;
float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float s=0.,a=.5;for(int i=0;i<4;i++){s+=a*n(p);p=p*2.03+vec2(1.7,9.2);a*=.5;}return s;}
void main(){
  vec2 uv=gl_FragCoord.xy/uRes;float asp=uRes.x/uRes.y;
  vec2 src=uSrc+uPtr*vec2(.03,.015);
  vec2 d=vec2((uv.x-src.x)*asp,uv.y-src.y);
  float r=length(d);float ang=atan(d.x,d.y);
  float breathe=uFloor+(1.-uFloor)*(.5+.4*sin(uTime*.55)+.1*sin(uTime*1.7));
  float rays=fbm(vec2(ang*5.,uTime*.06))*.7+fbm(vec2(ang*13.,-uTime*.04))*.5;
  rays=uRayFloor+(1.-uRayFloor)*smoothstep(.3,.95,rays);
  float up=smoothstep(-.25,.35,d.y);
  float shaft=rays*exp(-r*1.15)*breathe*(.45+.55*up)*uShaft;
  float core=exp(-r*r*26.)*.9*breathe;
  float fog=fbm(vec2(uv.x*2.6+uTime*.025,uv.y*3.2-uTime*.012));
  float band=smoothstep(uHorizon,uHorizon+.18,uv.y)*smoothstep(1.,uHorizon+.3,uv.y);
  vec2 g=vec2((uv.x-src.x)*asp*.55,(uv.y-(uHorizon-.07))*2.6);
  float pool=exp(-dot(g,g)*3.2)*step(uv.y,uHorizon+.004)*breathe;
  float motes=0.;
  for(int l=0;l<3;l++){
    float fl=float(l);float sc=26.+fl*30.;
    vec2 q=uv*vec2(sc*asp,sc)+vec2(sin(uTime*.2+fl)*.6,uTime*(.18+.09*fl));
    vec2 id=floor(q);vec2 f=fract(q)-.5;float rnd=h(id+fl*7.3);
    vec2 off=vec2(h(id+3.1),h(id+5.7))-.5;
    float size=.11-.03*fl;
    motes+=step(.83,rnd)*smoothstep(size,0.,length(f-off*.7))*(.55+.45*sin(uTime*2.3+rnd*40.))*(1.2-.3*fl);
  }
  motes*=clamp(shaft*3.2+pool*2.+core,0.,1.4);
  vec3 col=uGold*(shaft*1.15+pool*.85+fog*band*.3)+uHot*(core*.8+motes);
  float a=clamp(shaft*.95+pool*.7+core*uShaft+fog*band*.3+motes,0.,uAlpha);
  o=vec4(col,a);
}`;

function rgb(color: string): [number, number, number] {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d');
  if (!ctx) return [0.7, 0.57, 0.31];
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return [r! / 255, g! / 255, b! / 255];
}

export function mountAtmos(slot: HTMLElement, root: HTMLElement, options: { reducedMotion: boolean }): boolean {
  const canvas = document.createElement('canvas');
  canvas.dataset.atmosCanvas = '';
  canvas.dataset.atmosFrames = '0';
  const gl = canvas.getContext('webgl2', { premultipliedAlpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' });
  if (!gl) return false;

  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
  };
  const vs = compile(gl.VERTEX_SHADER, VERTEX);
  const fs = compile(gl.FRAGMENT_SHADER, FRAGMENT);
  if (!vs || !fs) return false;
  const program = gl.createProgram()!;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return false;
  gl.useProgram(program);

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const at = gl.getAttribLocation(program, 'p');
  gl.enableVertexAttribArray(at);
  gl.vertexAttribPointer(at, 2, gl.FLOAT, false, 0, 0);
  const u = (name: string) => gl.getUniformLocation(program, name);
  const uRes = u('uRes');
  const uTime = u('uTime');
  const uSrc = u('uSrc');
  const uPtr = u('uPtr');
  const uHorizon = u('uHorizon');
  const token = getComputedStyle(document.documentElement);
  gl.uniform3fv(u('uGold'), rgb(token.getPropertyValue('--color-accent-strong').trim()));
  gl.uniform3fv(u('uHot'), rgb(token.getPropertyValue('--color-text').trim()));
  const phone = window.innerWidth < 960;
  gl.uniform1f(u('uShaft'), phone ? ATMOS.mobileShaft : 1);
  gl.uniform1f(u('uAlpha'), phone ? ATMOS.mobileAlpha : ATMOS.desktopAlpha);
  gl.uniform1f(u('uFloor'), ATMOS.breatheFloor);
  gl.uniform1f(u('uRayFloor'), ATMOS.rayFloor);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(0, 0, 0, 0);

  slot.append(canvas);

  let visible = true;
  let drawn = 0;
  let lastDraw = 0;
  let raf = 0;
  const started = performance.now();

  const resize = () => {
    const rect = slot.getBoundingClientRect();
    const width = Math.max(1, Math.min(ATMOS.maxWidth, Math.round(rect.width * ATMOS.scale)));
    const height = Math.max(1, Math.round((width * rect.height) / Math.max(1, rect.width)));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
    }
  };

  const draw = (now: number) => {
    resize();
    const style = getComputedStyle(root);
    // 地平線（由上往下的 %）換成著色器的座標（由下往上 0–1）；光源是門洞，在地平線上方一點。
    const horizon = 1 - (parseFloat(style.getPropertyValue('--horizon')) || 74) / 100;
    const ox = (parseFloat(style.getPropertyValue('--ox')) || 50) / 50 - 1;
    const oy = (parseFloat(style.getPropertyValue('--oy')) || 50) / 50 - 1;
    gl.uniform2f(uRes, canvas.width, canvas.height);
    gl.uniform1f(uTime, options.reducedMotion ? 8 : (now - started) / 1000);
    gl.uniform2f(uSrc, 0.5, horizon + 0.13);
    gl.uniform2f(uPtr, ox, -oy);
    gl.uniform1f(uHorizon, horizon);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    drawn += 1;
    lastDraw = now;
    canvas.dataset.atmosFrames = String(drawn);
  };

  const tick = (now: number) => {
    raf = 0;
    if (atmosFrameDue({ sinceLast: now - lastDraw, visible: visible && !document.hidden, reducedMotion: options.reducedMotion, drawn })) draw(now);
    if (!options.reducedMotion && visible) raf = requestAnimationFrame(tick);
  };
  const wake = () => {
    if (!raf) raf = requestAnimationFrame(tick);
  };

  new IntersectionObserver((entries) => {
    visible = entries.some((entry) => entry.isIntersecting);
    if (visible) wake();
  }).observe(slot);
  document.addEventListener('visibilitychange', wake);
  window.addEventListener('resize', () => {
    if (options.reducedMotion) draw(performance.now());
  });
  wake();
  return true;
}
