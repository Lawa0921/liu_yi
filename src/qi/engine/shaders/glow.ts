/**
 * 光暈的著色器（D15，自寫，不用 `EffectComposer`／`UnrealBloomPass`）：
 *   場景（線性 HalfFloat，半解析度）→ `blurFragment` 可分離 9-tap 高斯（1/4 解析度，橫再直）→ `compositeFragment` 疊加＋ACES 色調映射。
 * GLSL 字串會被打進引擎 chunk，字型守門會掃它：字串內不放中文。
 */

/** 9-tap 高斯的 sigma（以 tap 為單位）。 */
export const BLUR_SIGMA = 2.2;

export const fullscreenVertex = /* glsl */ `
varying vec2 vUv;
void main(){
  vUv=uv;
  gl_Position=vec4(position.xy,0.0,1.0);
}
`;

/**
 * 可分離的 9-tap 高斯。`uStep` ＝ 取樣間距（方向 × texel 大小）。
 * `uThreshold > 0`（只在第一道橫向 pass 用）：每個 tap 先做柔膝高光抽取，只有夠亮的光點才會暈開，
 * 沒有它，所有光點一視同仁地發光，整張圖就糊成一層外發光（反目標）。
 */
export const blurFragment = /* glsl */ `
uniform sampler2D tInput;
uniform vec2 uStep;
uniform float uThreshold;
varying vec2 vUv;
vec3 bright(vec3 c){
  if(uThreshold<=0.0) return c;
  float l=max(c.r,max(c.g,c.b));
  float knee=uThreshold*0.5;
  float soft=clamp(l-uThreshold+knee,0.0,2.0*knee);
  soft=soft*soft/(4.0*knee+1e-5);
  return c*(max(soft,l-uThreshold)/max(l,1e-5));
}
void main(){
  vec3 sum=vec3(0.0);
  float total=0.0;
  for(int i=-4;i<=4;i++){
    float w=exp(-float(i*i)/(2.0*${BLUR_SIGMA.toFixed(2)}*${BLUR_SIGMA.toFixed(2)}));
    sum+=bright(texture2D(tInput,vUv+uStep*float(i)).rgb)*w;
    total+=w;
  }
  gl_FragColor=vec4(sum/total,1.0);
}
`;

/** 場景＋光暈 → 色調映射＋輸出色彩空間；底色在顯示空間加回去（場景 RT 的底是黑的，所以空畫面剛好是底色）。 */
export const compositeFragment = /* glsl */ `
uniform sampler2D tScene;
uniform sampler2D tGlow;
uniform float uGlow;
uniform vec3 uBackdrop;
varying vec2 vUv;
void main(){
  vec3 c=texture2D(tScene,vUv).rgb+texture2D(tGlow,vUv).rgb*uGlow;
  gl_FragColor=vec4(c,1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  gl_FragColor.rgb+=uBackdrop;
}
`;
