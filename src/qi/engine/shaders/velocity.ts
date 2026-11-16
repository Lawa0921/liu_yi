/**
 * 速度著色器（搬自試作，新增 `uImpulseMode = 3`）：吸回目標的彈簧、curl noise 的煙、掌風、換招的衝量。
 * 衝量只在發生的那一格有值（`uImpulse.w > 0`）。
 *
 * 常數集中在這個檔案頂端（彈簧的整體強度 `SPRING` 在 `../forces.ts`，吸氣的常數 `INHALE` 在 `../effects.ts`）。
 * GLSL 字串會被打進引擎 chunk，字型守門會掃它：字串內不放中文，說明寫在 TS 註解。
 */

import { INHALE, INHALE_EXPONENT } from '../effects';
import { HASH, NOISE } from './noise';

/** 每顆光點的彈簧係數範圍：勁不一樣，聚合時有先到有後到，邊緣才像煙。 */
export const SPRING_JITTER = { min: 0.45, max: 1.5 } as const;
/** 環境煙的彈簧（固定、很鬆）。 */
export const AMBIENT_SPRING = 0.25;
/** 掌風的影響半徑（世界單位）。 */
export const HAND_RADIUS = 0.5;
/** 衝量的中心（人形身高一半的位置）：模式 3 往這裡收、模式 0 以它判斷出招的那一側。 */
export const IMPULSE_CENTER: readonly [number, number, number] = [0, 1, 0];

const f = (n: number): string => n.toFixed(3);

/**
 * `uImpulseMode`：
 *   0 順著方向（出招那一側炸得最兇）；1 左右分開（撐捶）；2 從腳下往四周（震腳）；3 向內收（朱印：往中心壓）。
 * 環境煙的衝量一律乘 0.25，不搶人形的戲。
 */
export const velocityShader = /* glsl */ `
uniform sampler2D tTarget;
uniform float uTime;
uniform float uDt;
uniform float uSpring;
uniform float uCurl;
uniform float uDamp;
uniform vec3 uHandA;
uniform vec3 uHand;
uniform vec3 uHandVel;
uniform float uHandR;
uniform vec4 uImpulse;
uniform float uImpulseMode;
uniform vec3 uImpulseCenter;
uniform float uInhale;
${HASH}
${NOISE}
// intro inhale: acceleration toward the center, with a little swirl around y (same formula as inhaleAcc in ../effects.ts)
vec3 inhaleAcc(vec3 p,float t){
  float env=(t>0.0&&t<1.0)?sin(3.14159265*pow(t,${INHALE_EXPONENT.toFixed(4)})):0.0;
  float r=length(p);
  float pull=${f(INHALE.pull)}*(${f(INHALE.floor)}+(1.0-${f(INHALE.floor)})*smoothstep(0.0,${f(INHALE.reach)},r))*env;
  float toward=pull/(r+0.001);
  float swirl=${f(INHALE.swirl)}*env/(r+${f(INHALE.softening)});
  return vec3(-p.x*toward+p.z*swirl,-p.y*toward,-p.z*toward-p.x*swirl);
}
void main(){
  vec2 uv=gl_FragCoord.xy/resolution.xy;
  vec4 p=texture2D(texturePosition,uv);
  vec4 v=texture2D(textureVelocity,uv);
  vec4 tg=texture2D(tTarget,uv);
  float h1=hash12(uv*917.3);
  float h2=hash12(uv*331.7+4.1);
  bool ambient=tg.w<-0.5;

  // spring toward the target, a different strength per particle
  float k=uSpring*mix(${f(SPRING_JITTER.min)},${f(SPRING_JITTER.max)},h1);
  if(ambient) k=${f(AMBIENT_SPRING)};
  vec3 acc=(tg.xyz-p.xyz)*k;

  // smoke: the farther from the target the stronger; only a light tremor once settled
  float away=clamp(length(tg.xyz-p.xyz)*1.5,0.0,1.0);
  float amp=uCurl*(0.12+away*1.2+(ambient?1.4:0.0)+step(0.94,h2)*0.6);
  acc+=curl(p.xyz*0.55+vec3(0.0,uTime*0.06,uTime*0.03))*amp;

  // palm wind: blow along the gesture inside the radius, with a swirl.
  // The hand moved along the segment uHandA to uHand this frame (a mouse can jump far), so take the nearest point on it.
  vec2 ab=uHand.xy-uHandA.xy;
  float t=clamp(dot(p.xy-uHandA.xy,ab)/max(dot(ab,ab),1e-5),0.0,1.0);
  vec2 d=p.xy-(uHandA.xy+ab*t);
  float r=length(d);
  float f=exp(-(r*r)/(uHandR*uHandR));
  float speed=length(uHandVel);
  vec3 swirl=vec3(-d.y,d.x,(h2-0.5)*2.0*r)/(r+0.08);
  acc+=(uHandVel*3.0+vec3(d/(r+0.001),0.0)*speed*1.8+swirl*speed*1.3)*f*mix(0.6,1.4,h1);

  v.xyz+=acc*uDt;

  // inhale: streamlines toward the center (the ambient smoke stays out: its spring is so loose it would take many seconds to drift back)
  if(uInhale>0.0&&!ambient) v.xyz+=inhaleAcc(p.xyz-uImpulseCenter,uInhale)*uDt;

  if(uImpulse.w>0.0){
    vec3 rnd=normalize(hash32(uv*173.1+uTime)-0.5);
    vec3 rel=p.xyz-uImpulseCenter;
    vec3 dir=uImpulse.xyz;
    float weight=1.0;
    if(uImpulseMode<0.5){
      weight=0.45+smoothstep(-1.2,1.2,dot(rel,normalize(dir)))*1.1;
    }else if(uImpulseMode<1.5){
      dir=vec3(sign(rel.x+0.001)*abs(dir.x),dir.y,dir.z);
      weight=0.5+smoothstep(0.0,1.0,abs(rel.x));
    }else if(uImpulseMode<2.5){
      vec2 spread=rel.xz+(hash32(uv*51.0).xy-0.5)*0.4;
      dir=normalize(vec3(spread.x,0.35,spread.y));
      weight=0.5+1.4*(1.0-smoothstep(0.0,1.2,p.y));
    }else{
      // inward: toward the center with a little push along the impulse direction; the farther, the stronger
      dir=normalize(-rel/(length(rel)+0.001)+uImpulse.xyz*0.25);
      weight=0.55+0.9*smoothstep(0.0,2.5,length(rel));
    }
    if(ambient) weight*=0.25;
    v.xyz+=(dir*mix(0.5,1.6,h2)+rnd*0.45)*uImpulse.w*weight;
  }

  v.xyz*=exp(-uDamp*uDt);
  gl_FragColor=v;
}
`;
