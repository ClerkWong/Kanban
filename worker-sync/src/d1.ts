// 最小 D1 型別宣告：避免引入 @cloudflare/workers-types 依賴，
// 也避免與 worker/types.d.ts 的全域宣告衝突（此處為模組作用域）。
export type D1Row = Record<string, unknown>;

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = D1Row>(): Promise<T | null>;
  run(): Promise<{ meta: { changes: number } }>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
}
