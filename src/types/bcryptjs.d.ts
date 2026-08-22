declare module 'bcryptjs' {
  export function hash(data: string, rounds: number): Promise<string>;
  export function hash(data: string, rounds: number, callback: (err: Error | null, hash: string) => void): void;
  export function compare(data: string, encrypted: string): Promise<boolean>;
  export function compare(data: string, encrypted: string, callback: (err: Error | null, same: boolean) => void): void;
}
