/**
 * 地面：一片很淡的光點。落地時兩圈沖擊波往外擴（`uRing1`、`uRing2` ＝ 半徑、寬度、亮度，由 `effects.ts` 的
 * `shockwave`／`shockwaveSecond` 每格算好餵進來；亮度 0 ＝ 沒有這一圈），腳下另有一下白閃（`uFlash`）。
 * 片段著色器與光點共用（`pointsFragment`），所以也輸出（不拉長的）`vDir`、`vAspect`。搬自試作，圈的亮度加強。
 * GLSL 字串會被打進引擎 chunk，字型守門會掃它：字串內不放中文。
 */

import { SHOCK } from '../effects';

/** 地面光點數（桌機／低階各一）與分布半徑（世界單位）。 */
export const GROUND = { count: { rich: 6000, lite: 2200 }, radius: 5, depth: 0.9 } as const;

export const groundVertex = /* glsl */ `
uniform vec3 uRing1;
uniform vec3 uRing2;
uniform float uFlash;
uniform float uPx;
uniform float uFocus;
uniform float uPixelRatio;
uniform float uLevel;
uniform vec3 uGold;
uniform vec3 uPaper;
attribute float seed;
varying vec3 vColor;
varying float vAlpha;
varying vec2 vDir;
varying float vAspect;
void main(){
  vec3 pos=position;
  float r=length(pos.xz);
  // two rings: x radius, y width, z strength (0 = not launched yet)
  float ring=0.0;
  if(uRing1.z>0.0) ring+=exp(-pow((r-uRing1.x)/uRing1.y,2.0))*uRing1.z;
  if(uRing2.z>0.0) ring+=exp(-pow((r-uRing2.x)/uRing2.y,2.0))*uRing2.z;
  float lit=ring/${SHOCK.amp0.toFixed(3)};
  // the flash: a burst of paper white under the feet that dies out quickly
  float flash=uFlash*exp(-r*1.4);
  pos.y+=lit*0.07*seed;
  vec4 mv=modelViewMatrix*vec4(pos,1.0);
  gl_Position=projectionMatrix*mv;
  float base=0.1*exp(-r*0.7)*uLevel;
  vAlpha=base+ring+flash*1.6;
  vColor=mix(mix(uGold,uPaper,lit*0.8+seed*0.2),uPaper*1.4,clamp(flash*2.0,0.0,1.0));
  gl_PointSize=max(1.0,uPx*uPixelRatio*(0.7+seed*0.6+lit*0.8)*uFocus/max(-mv.z,0.1));
  vDir=vec2(1.0,0.0);
  vAspect=1.0;
}
`;
