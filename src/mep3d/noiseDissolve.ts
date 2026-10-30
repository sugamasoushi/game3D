import { Color, Mesh, ShaderMaterial, Vector3, type Material, type Object3D, type Texture } from 'three';
import { dissolveProgress } from './noiseEffects';

export interface DissolveRegion {
  min: Vector3;
  max: Vector3;
  color: string;
  scale: number;
  amount: number;
  speed: number;
  progress: number;
  weight: number;
  appear: boolean;
  richness?: number;
}

/** 可変数の領域を材質へ渡す。既存のworld座標を再利用し頂点属性は増やさない。 */
export function createNoiseDissolve(map: Texture) {
  const patched = new Map<Material, { compile: Material['onBeforeCompile']; key: Material['customProgramCacheKey'] }>();
  const uniforms = {
    mepDissolveMap: { value: map },
    mepDissolveMin: { value: [new Vector3()] },
    mepDissolveMax: { value: [new Vector3()] },
    mepDissolveTint: { value: [new Color()] },
    mepDissolveParams: { value: [new Vector3()] },
    mepDissolveCount: { value: 0 },
    mepDissolveRich: { value: [1] },
  };
  let capacity = 1;
  const declarations = () => `
uniform sampler2D mepDissolveMap;
uniform vec3 mepDissolveMin[${capacity}];
uniform vec3 mepDissolveMax[${capacity}];
uniform vec3 mepDissolveTint[${capacity}];
uniform vec3 mepDissolveParams[${capacity}];
uniform int mepDissolveCount;
uniform float mepDissolveRich[${capacity}];
`;
  const fragment = (world: string) => `
for(int di=0;di<${capacity};di++) {
  if(di>=mepDissolveCount) break;
  vec3 dp=${world};
  if(all(greaterThanEqual(dp,mepDissolveMin[di])) && all(lessThanEqual(dp,mepDissolveMax[di]))) {
    vec3 params=mepDissolveParams[di];
    if(params.x<=0.0 || params.z<=0.0) continue;
    vec2 samplePos=(dp.xy+dp.z*vec2(0.37,0.73))*params.y;
    float n=texture2D(mepDissolveMap,samplePos).r;
    float rich=mepDissolveRich[di];
    if(rich>0.001) n=mix(n,n*0.72+texture2D(mepDissolveMap,samplePos*0.37+0.21).r*0.28,rich);
    float threshold=params.x*1.04-0.02;
    if(n<threshold) discard;
    float rim=1.0-smoothstep(0.0,0.07,n-threshold);
    gl_FragColor.rgb+=mepDissolveTint[di]*rim*params.z;
    if(rich>0.001) {
      float glow=exp(-max(0.0,n-threshold)*18.0);
      float core=1.0-smoothstep(0.0,0.018,n-threshold);
      float flecks=pow(texture2D(mepDissolveMap,samplePos*2.7).r,4.0)*glow;
      gl_FragColor.rgb+=rich*params.z*(mepDissolveTint[di]*(glow*1.4+flecks)+vec3(1.0,0.9,0.72)*core*0.65);
    }
  }
}
`;
  const attach = (material: Material) => {
    if (patched.has(material)) return;
    // 色の本体だけを対象にする（影・深度の専用材質は変更しない）。
    const custom = material instanceof ShaderMaterial;
    if (custom && !material.fragmentShader.includes('varying vec3 vWorldPos;')) return;
    const compile = material.onBeforeCompile;
    const key = material.customProgramCacheKey;
    patched.set(material, { compile, key });
    material.onBeforeCompile = function(shader, renderer) {
      compile.call(this, shader, renderer);
      Object.assign(shader.uniforms, uniforms);
      const world = custom ? 'vWorldPos' : 'mepDissolveWorld';
      if (!custom) {
        shader.vertexShader = 'varying vec3 mepDissolveWorld;\n' + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `
#include <project_vertex>
vec4 dissolveLocal=vec4(transformed,1.0);
#ifdef USE_INSTANCING
dissolveLocal=instanceMatrix*dissolveLocal;
#endif
mepDissolveWorld=(modelMatrix*dissolveLocal).xyz;
`);
        shader.fragmentShader = 'varying vec3 mepDissolveWorld;\n' + shader.fragmentShader;
      }
      // GLSLの最後のmainの閉じ括弧へ差す。色出力・色空間変換の後なので光の縁も見える。
      const end = shader.fragmentShader.lastIndexOf('}');
      shader.fragmentShader = declarations() + shader.fragmentShader.slice(0, end) + fragment(world) + shader.fragmentShader.slice(end);
    };
    material.customProgramCacheKey = () => key.call(material) + `|noise-dissolve-${capacity}`;
    material.needsUpdate = true;
  };
  return {
    update(regions: readonly DissolveRegion[], sources: readonly Object3D[], excluded: Object3D, time: number) {
      if (regions.length > capacity) {
        capacity = regions.length;
        for (const material of patched.keys()) material.needsUpdate = true;
      }
      uniforms.mepDissolveCount.value = regions.length;
      uniforms.mepDissolveRich.value = regions.length ? regions.map(r=>r.richness ?? 1) : [1];
      uniforms.mepDissolveMin.value = regions.length ? regions.map(r => r.min) : [new Vector3()];
      uniforms.mepDissolveMax.value = regions.length ? regions.map(r => r.max) : [new Vector3()];
      uniforms.mepDissolveTint.value = regions.length ? regions.map(r => new Color(r.color)) : [new Color()];
      uniforms.mepDissolveParams.value = regions.length ? regions.map(r => new Vector3(dissolveProgress(time,r.speed,r.progress,r.appear)*r.weight,r.scale,r.amount)) : [new Vector3()];
      // Uniform配列は宣言の長さまで埋める（領域を減らした時のGPU転送も保証する）。
      for (const uniform of [uniforms.mepDissolveMin, uniforms.mepDissolveMax, uniforms.mepDissolveParams]) {
        while (uniform.value.length < capacity) uniform.value.push(new Vector3());
      }
      while (uniforms.mepDissolveTint.value.length < capacity) uniforms.mepDissolveTint.value.push(new Color());
      while (uniforms.mepDissolveRich.value.length < capacity) uniforms.mepDissolveRich.value.push(0);
      if (!regions.length) return;
      for (const source of sources) {
        if (source === excluded) continue;
        source.traverse(object => {
          if (!(object instanceof Mesh)) return;
          for (const material of Array.isArray(object.material) ? object.material : [object.material]) attach(material);
        });
      }
    },
    dispose() {
      for (const [material, original] of patched) {
        material.onBeforeCompile = original.compile;
        material.customProgramCacheKey = original.key;
        material.needsUpdate = true;
      }
      patched.clear();
    },
  };
}
