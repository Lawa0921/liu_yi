/**
 * 光暈的著色器（D15，自寫，不用 `EffectComposer`／`UnrealBloomPass`）：
 *   場景（線性 HalfFloat，全解析度）→ `blurFragment` 可分離 9-tap 高斯（1/4 解析度，橫再直，多輪）→ `compositeFragment`
 *   把近光暈、遠光暈與場景疊加＋ACES 色調映射。
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
 * 抽取用 Rec.709 亮度（試作的 `UnrealBloomPass` 也是亮度；純紅的纓穗亮度低，不會自己暈出一團紅光），
 * 並把亮度夾在 `uClamp` 以下：極亮的密集點（槍頭）與快速移動而變亮的人形，暈出去的光不會比平常的人形更多。
 */
export const blurFragment = /* glsl */ `
uniform sampler2D tInput;
uniform vec2 uStep;
uniform float uThreshold;
uniform float uClamp;
varying vec2 vUv;
vec3 bright(vec3 c){
  if(uThreshold<=0.0) return c;
  float l=dot(c,vec3(0.2126,0.7152,0.0722));
  c*=min(1.0,uClamp/max(l,1e-5));
  l=min(l,uClamp);
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
uniform sampler2D tNear;
uniform sampler2D tFar;
uniform float uNear;
uniform float uFar;
uniform vec3 uBackdrop;
varying vec2 vUv;
void main(){
  vec3 c=texture2D(tScene,vUv).rgb+texture2D(tNear,vUv).rgb*uNear+texture2D(tFar,vUv).rgb*uFar;
  gl_FragColor=vec4(c,1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  gl_FragColor.rgb+=uBackdrop;
}
`;
