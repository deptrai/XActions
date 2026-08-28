declare module 'nodemailer' {
  export interface SendMailOptions {
    from?: string;
    to?: string;
    subject?: string;
    text?: string;
    html?: string;
  }

  export interface Transporter {
    sendMail(options: SendMailOptions): Promise<any>;
  }

  export function createTransport(options?: any): Transporter;

  const _default: {
    createTransport(options?: any): Transporter;
  };
  export default _default;
}
