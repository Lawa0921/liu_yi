/**
 * 光點：讀位置貼圖，近大遠小、加色混合。`uMirror = 1` 時畫地面倒影（搬自試作）。
 *
 * `w`（種類，見 `shapes/format.ts` 的 `kindToW`）：-1 環境煙；0–1 人形（靠近輪廓的程度）；2 鋼；3 銅件；4 朱紅（纓穗）；
 * 5 暗色（柄、桿）；6 兵器四周的氣；7 朱印；8 竹簡的竹片（比人形淡）；9 光點館徽（金）。色票只有金／米白／朱紅（反目標：沒有彩色特效）。
 *
 * 拖尾（Task 16）：頂點著色器把速度投影到螢幕，輸出方向 `vDir` 與橢圓長寬比 `vAspect`；沿速度方向的拉長倍數是
 * `min(streakLength(速度), uStreak)`（`uStreak` 由舞台依換招衝量與開場吸氣的包絡決定；平時是 1，所有點都是圓的）。
 * 點精靈放大到沿速度方向的長度，片段著色器依 `vDir` 把圓畫成橢圓（長軸沿速度）；拉得越長橫向也收得越細
 * （`STREAK.aspect`），才看得出是一條線而不是一顆變大的點。能量守恆：拉得越長每格越淡。
 *
 * 有定義 `QI_DIRECT` 時是「直接畫到螢幕」（低階 tier 沒有光暈）：片段著色器自己做線性→輸出色彩空間的轉換。
 * 沒有定義時畫進線性的 HalfFloat 場景 RT，色調映射與編碼由光暈的合成 pass 做。
 * GLSL 字串會被打進引擎 chunk，字型守門會掃它：字串內不放中文。
 */

import { STREAK, THICK_KIND_SCALE } from '../effects';
import { SHAPE_COUNT } from '../../shapes/format';
import { HASH } from './noise';

/**
 * 顆粒（世界單位）：每顆光點依自己的種子在目標位置附近固定偏一小段。形體檔每個點在高階 tier 會重複 4 次
 * （D10 的 0.006 抖動只讓它們不重疊成一個），疊在一起像一顆大亮點，人形成了「亮點加暗縫」；再散開一點才像試作
 * 那種細而均勻的顆粒。只是畫出來的位置，不影響模擬與目標。
 */
export const GRAIN = 0.02;
/**
 * 光點館徽（kind > 8.5，`KIND.CREST`）的顆粒：0＝不抖。館徽是細線條，GRAIN 的 ±0.01 會把線條抖散成一片糊（Task 25 審查；形體檔的重複點另有 `expand.ts` 的 `CREST_JITTER`）。
 * 其他種類不變。
 */
export const CREST_GRAIN = 0;
/** 地面倒影的亮度（試作 0.16；半解析度時代的倒影只剩約 3 成，這裡對回試作的觀感）。 */
export const REFLECTION = 0.2;
/**
 * 兵器上最密的幾種點（鋼、銅、朱紅纓、兵器四周的氣）在高階 tier 會疊成白團：槍頭與纓穗的面積很小，點數卻是人形的同一個量級。
 * 依覆蓋密度（`uCoverage`，見 `coverageOf`）調淡：`pow(uCoverage, -DENSE_POWER)`，最多回到原亮度（不加亮）。
 * 對照視窗的高階桌機（4）約 0.38，手機 low（約 4）也約 0.38，min 不變。朱紅纓另外把基準亮度由 0.75 降到 0.5：大槍的纓穗又細又密（點數占約 9%），
 * 0.75 加色後核心會糊成橘白，降到 0.5 才是紅色；纓穗與桿（DARK）的點徑加大 `THICK_KIND_SCALE`（15%），桿才看得出粗細。
 */
export const DENSE_POWER = 0.7;

/** 調參用的對照視窗（1280×720）：焦點平面上每個世界單位是幾個 CSS 像素（`720 / 3.4`；人形佔畫面的比例見 `stage.ts` 的取景）。 */
export const COVERAGE_REFERENCE_PX_PER_UNIT = 720 / 3.4;

/**
 * 覆蓋密度（`uCoverage`）：兵器上同一小塊面積被多少倍的點疊到，相對於「1280×720、桌機點徑、形體檔原本的點數」。
 * 重疊的亮度正比於「點數 × 點面積 / 兵器佔的螢幕面積」，所以要同時看三件事：
 *   - 點數：點數 / 形體檔的點數（高階 4 倍）；
 *   - 點徑：手機 low／lite 的點徑 2.6（桌機 2.2），面積是 1.4 倍；
 *   - 世界單位的螢幕大小：手機直向取景小（約 142 px／單位，對照視窗 212），同一件兵器在螢幕上只佔 0.45 倍的面積。
 * 只看點數會讓手機 low 的槍頭燒白、纓穗被沖成黃白（Task 16 審查）。
 */
export function coverageOf(count: number, pointPx: number, pxPerUnit: number): number {
  const sizeRatio = (pointPx * COVERAGE_REFERENCE_PX_PER_UNIT) / (POINT_PX.rich * pxPerUnit);
  return (count / SHAPE_COUNT) * sizeRatio * sizeRatio;
}

/** 兵器密集點的亮度倍率：`min(1, 覆蓋密度 ^ −DENSE_POWER)`（著色器裡是同一個式子）。 */
export const denseFade = (coverage: number): number => Math.min(1, Math.pow(coverage, -DENSE_POWER));

/** 光點大小的像素基準（桌機／低階各一）；實際 `gl_PointSize` 還乘以隨機大小與景深。 */
export const POINT_PX = { rich: 2.2, lite: 2.6 } as const;

const f = (n: number): string => n.toFixed(3);

export const pointsVertex = /* glsl */ `
uniform sampler2D tPos;
uniform sampler2D tVel;
uniform float uPx;
uniform float uFocus;
uniform float uPixelRatio;
uniform float uMirror;
uniform float uStreak;
uniform float uCoverage;
uniform vec3 uGold;
uniform vec3 uPaper;
uniform vec3 uSeal;
attribute vec2 ref;
attribute float seed;
varying vec3 vColor;
varying float vAlpha;
varying vec2 vDir;
varying float vAspect;
${HASH}
void main(){
  vec4 p=texture2D(tPos,ref);
  vec3 vel=texture2D(tVel,ref).xyz;
  float kind=p.w;
  float grain=kind>8.5?${CREST_GRAIN.toFixed(4)}:${GRAIN.toFixed(4)};
  vec3 pos=p.xyz+(hash32(ref*613.7+seed)-0.5)*grain;
  if(uMirror>0.5){pos.y=-pos.y;vel.y=-vel.y;}
  vec4 mv=modelViewMatrix*vec4(pos,1.0);
  gl_Position=projectionMatrix*mv;

  float speed=clamp(length(vel)*${f(STREAK.speedScale)},0.0,1.0);
  float big=mix(0.55,1.45,seed);
  bool spark=fract(seed*97.13)<0.012;
  if(kind>7.5) spark=false; // bamboo and crest stay gold: no vermilion sparks

  // gold to paper white; outlines and fast particles are brighter
  vec3 c=mix(uGold,uPaper,clamp(fract(seed*13.7)*0.55+(kind>=0.0&&kind<=1.0?kind*0.45:0.0)+speed*0.15,0.0,1.0));
  float dense=min(1.0,pow(max(uCoverage,0.01),-${f(DENSE_POWER)}));
  float a=0.55;
  if(kind>1.5&&kind<2.5){c=mix(uPaper,vec3(1.0),0.15);a=0.42*dense;}
  else if(kind>2.5&&kind<3.5){c=uGold*1.2;a=0.55*dense;}
  else if(kind>3.5&&kind<4.5){c=uSeal*1.4;a=0.5*dense;big*=${f(THICK_KIND_SCALE)};}
  else if(kind>4.5&&kind<5.5){c=uGold*0.85;a=0.6;big*=${f(THICK_KIND_SCALE)};}
  else if(kind>5.5&&kind<6.5){c=mix(uGold,uPaper,fract(seed*7.3)*0.5);a=0.16*dense;}
  else if(kind>6.5&&kind<7.5){c=uSeal*1.4;a=0.75;}
  else if(kind>7.5&&kind<8.5){c=mix(uGold*0.9,uPaper,fract(seed*7.3)*0.25);a=0.3;}
  else if(kind>8.5){c=mix(uGold,uPaper,fract(seed*7.3)*0.3);a=0.6;}
  else if(kind<-0.5){a=0.35;big*=0.9;}
  if(spark){c=uSeal*1.8+vec3(0.15,0.04,0.0);a=1.0;big*=1.35;}

  float depthFade=clamp(1.15-(-mv.z-uFocus)*0.12,0.35,1.25);
  vAlpha=a*depthFade*(1.0+speed*0.2);
  if(uMirror>0.5) vAlpha*=p.y<0.0?0.0:${REFLECTION.toFixed(3)}*exp(-p.y*1.6);
  vColor=c;

  // streak: stretch along the screen-space velocity, capped by the stage-wide uStreak (1 = no streaks)
  float stretch=min(1.0+speed*${f(STREAK.gain)},max(uStreak,1.0));
  vec4 head=projectionMatrix*(mv+modelViewMatrix*vec4(vel*0.05,0.0));
  vec2 flow=head.xy/head.w-gl_Position.xy/gl_Position.w;
  flow.x*=projectionMatrix[1][1]/projectionMatrix[0][0]; // NDC to square pixels
  float flowLen=length(flow);
  vDir=flowLen>1e-7?flow/flowLen:vec2(1.0,0.0);
  float aspect=1.0+(stretch-1.0)*${f(STREAK.aspect)};
  vAspect=aspect;
  vAlpha/=max(1.0,stretch*stretch/aspect); // the sprite's area grows with stretch^2/aspect: keep the energy
  float size=max(1.0,uPx*uPixelRatio*big*uFocus/max(-mv.z,0.1));
  gl_PointSize=size*stretch;
}
`;

export const pointsFragment = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
varying vec2 vDir;
varying float vAspect;
void main(){
  vec2 q=(gl_PointCoord-0.5)*2.0;
  q.y=-q.y; // point coordinates run downward, the direction is in NDC (upward)
  float along=dot(q,vDir);
  float across=dot(q,vec2(-vDir.y,vDir.x))*vAspect;
  float r2=along*along+across*across;
  if(r2>1.0) discard;
  float a=exp(-r2*3.2);
  gl_FragColor=vec4(vColor,a*vAlpha);
#ifdef QI_DIRECT
  #include <colorspace_fragment>
#endif
}
`;
