/**
 * 光點：讀位置貼圖，近大遠小、加色混合。`uMirror = 1` 時畫地面倒影（搬自試作）。
 *
 * `w`（種類，見 `shapes/format.ts` 的 `kindToW`）：-1 環境煙；0–1 人形（靠近輪廓的程度）；2 鋼；3 銅件；4 朱紅（纓穗）；
 * 5 暗色（柄、桿）；6 兵器四周的氣；7 朱印。色票只有金／米白／朱紅（反目標：沒有彩色特效）。
 *
 * 有定義 `QI_DIRECT` 時是「直接畫到螢幕」（低階 tier 沒有光暈）：片段著色器自己做線性→輸出色彩空間的轉換。
 * 沒有定義時畫進線性的 HalfFloat 場景 RT，色調映射與編碼由光暈的合成 pass 做。
 * GLSL 字串會被打進引擎 chunk，字型守門會掃它：字串內不放中文。
 */

/** 光點大小的像素基準（桌機／低階各一）；實際 `gl_PointSize` 還乘以隨機大小與景深。 */
export const POINT_PX = { rich: 2.2, lite: 2.6 } as const;

export const pointsVertex = /* glsl */ `
uniform sampler2D tPos;
uniform sampler2D tVel;
uniform float uPx;
uniform float uFocus;
uniform float uPixelRatio;
uniform float uMirror;
uniform vec3 uGold;
uniform vec3 uPaper;
uniform vec3 uSeal;
attribute vec2 ref;
attribute float seed;
varying vec3 vColor;
varying float vAlpha;
void main(){
  vec4 p=texture2D(tPos,ref);
  vec3 vel=texture2D(tVel,ref).xyz;
  vec3 pos=p.xyz;
  float kind=p.w;
  if(uMirror>0.5) pos.y=-pos.y;
  vec4 mv=modelViewMatrix*vec4(pos,1.0);
  gl_Position=projectionMatrix*mv;

  float speed=clamp(length(vel)*0.25,0.0,1.0);
  float big=mix(0.55,1.45,seed);
  bool spark=fract(seed*97.13)<0.012;

  // gold to paper white; outlines and fast particles are brighter
  vec3 c=mix(uGold,uPaper,clamp(fract(seed*13.7)*0.55+(kind>=0.0&&kind<=1.0?kind*0.45:0.0)+speed*0.4,0.0,1.0));
  float a=0.55;
  if(kind>1.5&&kind<2.5){c=mix(uPaper,vec3(1.0),0.15);a=0.42;}
  else if(kind>2.5&&kind<3.5){c=uGold*1.2;a=0.55;}
  else if(kind>3.5&&kind<4.5){c=uSeal*1.4;a=0.75;}
  else if(kind>4.5&&kind<5.5){c=uGold*0.85;a=0.6;}
  else if(kind>5.5&&kind<6.5){c=mix(uGold,uPaper,fract(seed*7.3)*0.5);a=0.16;}
  else if(kind>6.5){c=uSeal*1.4;a=0.75;}
  else if(kind<-0.5){a=0.35;big*=0.9;}
  if(spark){c=uSeal*1.8+vec3(0.15,0.04,0.0);a=1.0;big*=1.35;}

  float depthFade=clamp(1.15-(-mv.z-uFocus)*0.12,0.35,1.25);
  vAlpha=a*depthFade*(1.0+speed*0.8);
  if(uMirror>0.5) vAlpha*=p.y<0.0?0.0:0.16*exp(-p.y*1.6);
  vColor=c;
  gl_PointSize=max(1.0,uPx*uPixelRatio*big*uFocus/max(-mv.z,0.1));
}
`;

export const pointsFragment = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main(){
  vec2 q=gl_PointCoord-0.5;
  float r2=dot(q,q)*4.0;
  if(r2>1.0) discard;
  float a=exp(-r2*3.2);
  gl_FragColor=vec4(vColor,a*vAlpha);
#ifdef QI_DIRECT
  #include <colorspace_fragment>
#endif
}
`;
