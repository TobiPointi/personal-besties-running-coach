declare module "cloudflare:workers" {
  export const env: Record<string, unknown>;
}

interface D1Result<T = Record<string, unknown>> {
  results?: T[];
  meta: { changes?: number; [key: string]: unknown };
  success?: boolean;
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}

interface D1Database {
  prepare(sql: string): D1PreparedStatement;
  batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
}

interface R2ObjectBody { body: ReadableStream; }
interface R2Bucket {
  put(key: string, value: ReadableStream | ArrayBuffer | string, options?: Record<string, unknown>): Promise<unknown>;
  get(key: string): Promise<R2ObjectBody | null>;
}
