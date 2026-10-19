declare module "node:path" {
  export function resolve(...paths: string[]): string;
}

declare var __dirname: string;
