// games.json 등 대용량 JSON을 tsc가 거대한 리터럴 타입으로 추론하지 않도록 unknown 처리.
// 런타임 번들링은 esbuild(wrangler)가 처리한다.
declare module "*.json" {
  const value: unknown;
  export default value;
}
