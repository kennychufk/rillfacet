// WGSL imports resolve to the shader source (includes expanded; vite.config.ts).
declare module "*.wgsl" {
  const source: string;
  export default source;
}
