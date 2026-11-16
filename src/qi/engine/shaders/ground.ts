/**
 * 地面：一片很淡的光點。`uShockT >= 0` 時一圈沖擊波往外擴（`t` 是衝擊後的秒數；落地時機由呼叫端決定，-1 表示沒有）。
 * 片段著色器與光點共用（`pointsFragment`）。搬自試作。
 * GLSL 字串會被打進引擎 chunk，字型守門會掃它：字串內不放中文。
 */

/** 地面光點數（桌機／低階各一）與分布半徑（世界單位）。 */
export const GROUND = { count: { rich: 6000, lite: 2200 }, radius: 5, depth: 0.9 } as const;

export const groundVertex = /* glsl */ `
uniform float uShockT;
uniform float uPx;
uniform float uFocus;
uniform float uPixelRatio;
uniform float uLevel;
uniform vec3 uGold;
uniform vec3 uPaper;
attribute float seed;
varying vec3 vColor;
varying float vAlpha;
void main(){
  vec3 pos=position;
  float r=length(pos.xz);
  float ring=0.0;
  if(uShockT>=0.0){
    float radius=0.25+uShockT*3.6-uShockT*uShockT*0.35;
    float w=0.12+uShockT*0.2;
    ring=exp(-pow((r-radius)/w,2.0))*exp(-uShockT*1.5);
    pos.y+=ring*0.07*seed;
  }
  vec4 mv=modelViewMatrix*vec4(pos,1.0);
  gl_Position=projectionMatrix*mv;
  float base=0.1*exp(-r*0.7)*uLevel;
  vAlpha=base+ring*1.6;
  vColor=mix(uGold,uPaper,ring*0.8+seed*0.2);
  gl_PointSize=max(1.0,uPx*uPixelRatio*(0.7+seed*0.6+ring*0.8)*uFocus/max(-mv.z,0.1));
}
`;
