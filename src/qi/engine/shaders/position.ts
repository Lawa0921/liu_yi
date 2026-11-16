/** 位置著色器：位置 += 速度 × dt；w 欄位直接抄目標的種類（人形／兵器／朱印／煙），點著色器據此上色。 */
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
