declare module 'qrcode-terminal' {
  export function generate(
    data: string,
    options: { small?: boolean },
    callback: (output: string) => void
  ): void;
}
