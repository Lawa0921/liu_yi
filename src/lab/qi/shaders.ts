// 試作「氣聚成人」的著色器。

/** Ashima 的 3D simplex noise（MIT），加上用它做的 curl noise。 */
const NOISE = /* glsl */ `
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0);
  const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy));
  vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz);
  vec3 l=1.0-g;
  vec3 i1=min(g.xyz,l.zxy);
  vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx;
  vec3 x2=x0-i2+C.yyy;
  vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857;
  vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z);
  vec4 x_=floor(j*ns.z);
  vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy;
  vec4 y=y_*ns.x+ns.yyyy;
  vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy);
  vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0;
  vec4 s1=floor(b1)*2.0+1.0;
  vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;
  vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x);
  vec3 p1=vec3(a0.zw,h.y);
  vec3 p2=vec3(a1.xy,h.z);
  vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);
  m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
vec3 snoise3(vec3 p){
  return vec3(snoise(p),snoise(p+vec3(31.4,-17.2,5.9)),snoise(p+vec3(-9.1,23.7,41.3)));
}
vec3 curl(vec3 p){
  const float e=0.1;
  vec3 dx=vec3(e,0.0,0.0),dy=vec3(0.0,e,0.0),dz=vec3(0.0,0.0,e);
  vec3 px0=snoise3(p-dx),px1=snoise3(p+dx);
  vec3 py0=snoise3(p-dy),py1=snoise3(p+dy);
  vec3 pz0=snoise3(p-dz),pz1=snoise3(p+dz);
  float x=py1.z-py0.z-pz1.y+pz0.y;
  float y=pz1.x-pz0.x-px1.z+px0.z;
  float z=px1.y-px0.y-py1.x+py0.x;
  return vec3(x,y,z)/(2.0*e);
}
`;

const HASH = /* glsl */ `
float hash12(vec2 p){vec3 p3=fract(vec3(p.xyx)*0.1031);p3+=dot(p3,p3.yzx+33.33);return fract((p3.x+p3.y)*p3.z);}
vec3 hash32(vec2 p){vec3 p3=fract(vec3(p.xyx)*vec3(0.1031,0.1030,0.0973));p3+=dot(p3,p3.yxz+33.33);return fract((p3.xxy+p3.yzz)*p3.zyx);}
`;

/**
 * 速度：吸回目標的彈簧、curl noise 的煙、掌風、換招的衝量。
 * 衝量只在發生的那一格有值（uImpulse.w > 0）。
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
uniform vec4 uImpulse;   // xyz 方向、w 力道
uniform float uImpulseMode; // 0 順著方向；1 左右分開（撐捶）；2 從腳下往四周（震腳）
uniform vec3 uImpulseCenter;
${HASH}
${NOISE}
void main(){
  vec2 uv=gl_FragCoord.xy/resolution.xy;
  vec4 p=texture2D(texturePosition,uv);
  vec4 v=texture2D(textureVelocity,uv);
  vec4 tg=texture2D(tTarget,uv);
  float h1=hash12(uv*917.3);
  float h2=hash12(uv*331.7+4.1);
  bool ambient=tg.w<-0.5;

  // 彈簧：每顆的勁不一樣，聚合時有先到有後到，邊緣才像煙。
  float k=uSpring*mix(0.45,1.5,h1);
  if(ambient) k=0.25;
  vec3 acc=(tg.xyz-p.xyz)*k;

  // 煙：離目標越遠飄得越厲害；在定位時只剩很輕的顫動。
  float away=clamp(length(tg.xyz-p.xyz)*1.5,0.0,1.0);
  float amp=uCurl*(0.12+away*1.2+(ambient?1.4:0.0)+step(0.94,h2)*0.6);
  acc+=curl(p.xyz*0.55+vec3(0.0,uTime*0.06,uTime*0.03))*amp;

  // 掌風：影響半徑內順著手勢吹開，再帶出旋渦。
  // 手這一格劃過的線段（滑鼠一格可能跳很遠），取最近點。
  vec2 ab=uHand.xy-uHandA.xy;
  float t=clamp(dot(p.xy-uHandA.xy,ab)/max(dot(ab,ab),1e-5),0.0,1.0);
  vec2 d=p.xy-(uHandA.xy+ab*t);
  float r=length(d);
  float f=exp(-(r*r)/(uHandR*uHandR));
  float speed=length(uHandVel);
  vec3 swirl=vec3(-d.y,d.x,(h2-0.5)*2.0*r)/(r+0.08);
  acc+=(uHandVel*3.0+vec3(d/(r+0.001),0.0)*speed*1.8+swirl*speed*1.3)*f*mix(0.6,1.4,h1);

  v.xyz+=acc*uDt;

  if(uImpulse.w>0.0){
    vec3 rnd=normalize(hash32(uv*173.1+uTime)-0.5);
    vec3 rel=p.xyz-uImpulseCenter;
    vec3 dir=uImpulse.xyz;
    float weight=1.0;
    if(uImpulseMode<0.5){
      // 出招那一側炸得最兇。
      weight=0.45+smoothstep(-1.2,1.2,dot(rel,normalize(dir)))*1.1;
    }else if(uImpulseMode<1.5){
      dir=vec3(sign(rel.x+0.001)*abs(dir.x),dir.y,dir.z);
      weight=0.5+smoothstep(0.0,1.0,abs(rel.x));
    }else{
      vec2 spread=rel.xz+(hash32(uv*51.0).xy-0.5)*0.4;
      dir=normalize(vec3(spread.x,0.35,spread.y));
      weight=0.5+1.4*(1.0-smoothstep(0.0,1.2,p.y));
    }
    if(ambient) weight*=0.25;
    v.xyz+=(dir*mix(0.5,1.6,h2)+rnd*0.45)*uImpulse.w*weight;
  }

  v.xyz*=exp(-uDamp*uDt);
  gl_FragColor=v;
}
`;

export const positionShader = /* glsl */ `
uniform sampler2D tTarget;
uniform float uDt;
void main(){
  vec2 uv=gl_FragCoord.xy/resolution.xy;
  vec4 p=texture2D(texturePosition,uv);
  vec4 v=texture2D(textureVelocity,uv);
  gl_FragColor=vec4(p.xyz+v.xyz*uDt,texture2D(tTarget,uv).w);
}
`;

/** 光點：讀位置貼圖，近大遠小、加色混合。uMirror = 1 時畫地面倒影。 */
export const pointsVertex = /* glsl */ `
uniform sampler2D tPos;
uniform sampler2D tVel;
uniform float uPx;
uniform float uFocus;
uniform float uPixelRatio;
uniform float uReveal;
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

  // 金到米白；輪廓與速度快的偏亮。
  vec3 c=mix(uGold,uPaper,clamp(fract(seed*13.7)*0.55+(kind>=0.0&&kind<=1.0?kind*0.45:0.0)+speed*0.4,0.0,1.0));
  float a=0.55;
  if(kind>1.5&&kind<2.5){c=mix(uPaper,vec3(1.0),0.15);a=0.42;}
  else if(kind>2.5&&kind<3.5){c=uGold*1.2;a=0.55;}
  else if(kind>3.5&&kind<4.5){c=uSeal*1.4;a=0.75;}
  else if(kind>4.5&&kind<5.5){c=uGold*0.85;a=0.6;}
  else if(kind>5.5){c=mix(uGold,uPaper,fract(seed*7.3)*0.5);a=0.16;}
  else if(kind<-0.5){a=0.35;big*=0.9;}
  if(spark){c=uSeal*1.8+vec3(0.15,0.04,0.0);a=1.0;big*=1.35;}

  // 開場：先只有零星幾顆，越聚越多。
  float shown=step(seed,uReveal);
  float depthFade=clamp(1.15-(-mv.z-uFocus)*0.12,0.35,1.25);
  vAlpha=a*shown*depthFade*(1.0+speed*0.8);
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
}
`;

/** 地面：一片很淡的光點，震腳落地時一圈沖擊波往外擴。 */
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
