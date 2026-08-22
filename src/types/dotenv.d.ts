declare module 'dotenv' {
  interface DotenvConfigOutput {
    error?: Error;
    parsed?: Record<string, string>;
  }
  function config(options?: Record<string, unknown>): DotenvConfigOutput;
  export = { config };
}
