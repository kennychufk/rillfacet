// WGSL sources, includes resolved at build time (vite.config.ts), optionally
// with a style: "./x.wgsl?style=matcap".
declare module "*.wgsl" {
  const src: string;
  export default src;
}
declare module "*.wgsl?style=studio" {
  const src: string;
  export default src;
}
declare module "*.wgsl?style=matcap" {
  const src: string;
  export default src;
}
declare module "*.wgsl?style=pbr" {
  const src: string;
  export default src;
}
declare module "*.wgsl?style=technical" {
  const src: string;
  export default src;
}
